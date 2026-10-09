import Foundation
import UIKit
import Capacitor
import GoogleSignIn

/**
 * Вход через Google для записи таблицы в Drive (Google Sign-In SDK) — аналог Android-плагина.
 *
 * `signIn` показывает выбор аккаунта и согласие на доступ к Drive; `getAccessToken` берёт
 * свежий токен без интерфейса (восстанавливает вход и обновляет токен). Если нужен пользователь —
 * отказ `authRequired`, окно из фона не открывается.
 *
 * Настройка: OAuth-клиент типа iOS (bundle id `com.somascan.app`) в Google Cloud Console;
 * его client ID — в Info.plist (`GIDClientID`), обратный client ID — в URL-схемах (см. README).
 */
@objc(GoogleDriveAuthPlugin)
public class GoogleDriveAuthPlugin: CAPInstancePlugin, CAPBridgedPlugin {
    public let identifier = "GoogleDriveAuthPlugin"
    public let jsName = "GoogleDriveAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAccessToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise)
    ]

    @objc public func signIn(_ call: CAPPluginCall) {
        let scopes = call.getArray("scopes", String.self) ?? []
        guard configure(call) else { return }
        DispatchQueue.main.async { [weak self] in
            guard let presenter = self?.bridge?.viewController else {
                call.reject("Нет окна для входа", "io")
                return
            }
            GIDSignIn.sharedInstance.signIn(withPresenting: presenter, hint: nil, additionalScopes: scopes) { result, error in
                if let error {
                    Self.reject(call, error)
                    return
                }
                guard let user = result?.user else {
                    call.reject("Google не вернул пользователя", "authRequired")
                    return
                }
                Self.resolve(call, user: user, scopes: scopes)
            }
        }
    }

    @objc public func getAccessToken(_ call: CAPPluginCall) {
        let scopes = call.getArray("scopes", String.self) ?? []
        GoogleDriveTokens.fetch(scopes: scopes) { result in
            switch result {
            case .success(let token):
                call.resolve(["accessToken": token])
            case .failure(let failure):
                call.reject(failure.message, failure.code, failure.error)
            }
        }
    }

    @objc public func signOut(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // Отзыв доступа: при следующем входе Google снова спросит аккаунт и согласие.
            GIDSignIn.sharedInstance.disconnect { _ in
                GIDSignIn.sharedInstance.signOut()
                call.resolve()
            }
        }
    }

    /// Настраивает SDK; без настройки отвечает `notConfigured`.
    private func configure(_ call: CAPPluginCall) -> Bool {
        if let failure = GoogleDriveTokens.configure() {
            call.reject(failure.message, failure.code)
            return false
        }
        return true
    }

    private static func resolve(_ call: CAPPluginCall, user: GIDGoogleUser, scopes: [String]) {
        switch GoogleDriveTokens.token(of: user, scopes: scopes) {
        case .success(let token):
            call.resolve(["accessToken": token])
        case .failure(let failure):
            call.reject(failure.message, failure.code)
        }
    }

    private static func reject(_ call: CAPPluginCall, _ error: Error) {
        let failure = GoogleDriveTokens.failure(of: error)
        call.reject(failure.message, failure.code, error)
    }
}

/**
 Токен доступа к Drive без интерфейса — для плагина (экран) и для движка очереди `UploadEngine`,
 который пишет таблицу и в свёрнутом приложении. Работает после входа в настройках (`signIn`);
 если нужен пользователь — отказ `authRequired`, окно из фона не открывается.
 */
enum GoogleDriveTokens {

    /// Область доступа к Drive (как `DRIVE_SCOPE` в веб-части).
    static let driveScope = "https://www.googleapis.com/auth/drive"

    /// Отказ с кодом для веб-части.
    struct Failure: Error {
        let code: String
        let message: String
        var error: Error?
    }

    /**
     Настраивает SDK по Info.plist; `nil` — готово. Без client ID или без URL-схемы для обратного
     вызова SDK падает исключением, поэтому сначала проверяем и отвечаем `notConfigured`.
     */
    static func configure() -> Failure? {
        let clientID = (Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        guard !clientID.isEmpty else {
            return Failure(code: "notConfigured", message: "Вход через Google не настроен: в Info.plist нет GIDClientID")
        }
        let reversed = clientID.components(separatedBy: ".").reversed().joined(separator: ".")
        let urlTypes = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] ?? []
        let schemes = urlTypes.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
        guard schemes.contains(where: { $0.caseInsensitiveCompare(reversed) == .orderedSame }) else {
            return Failure(code: "notConfigured", message: "Вход через Google не настроен: в URL-схемах нет \(reversed)")
        }
        if GIDSignIn.sharedInstance.configuration?.clientID != clientID {
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
        }
        return nil
    }

    /// Свежий токен: восстанавливает вход и обновляет токен; ответ — на главном потоке.
    static func fetch(scopes: [String], completion: @escaping (Result<String, Failure>) -> Void) {
        DispatchQueue.main.async {
            if let failure = configure() {
                completion(.failure(failure))
                return
            }
            let refresh: (GIDGoogleUser) -> Void = { user in
                user.refreshTokensIfNeeded { refreshed, error in
                    if let error {
                        completion(.failure(failure(of: error)))
                        return
                    }
                    completion(token(of: refreshed ?? user, scopes: scopes))
                }
            }
            if let user = GIDSignIn.sharedInstance.currentUser {
                refresh(user)
            } else if GIDSignIn.sharedInstance.hasPreviousSignIn() {
                GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in
                    if let user {
                        refresh(user)
                    } else {
                        completion(.failure(Failure(code: "authRequired", message: error?.localizedDescription ?? "Нужно войти в Google заново", error: error)))
                    }
                }
            } else {
                completion(.failure(Failure(code: "notSignedIn", message: "Вход в Google не выполнен")))
            }
        }
    }

    /// Токен пользователя, если у него есть все нужные области.
    static func token(of user: GIDGoogleUser, scopes: [String]) -> Result<String, Failure> {
        let granted = Set(user.grantedScopes ?? [])
        guard scopes.allSatisfy({ granted.contains($0) }) else {
            return .failure(Failure(code: "authRequired", message: "Нет доступа к Google Drive — войдите заново и разрешите доступ"))
        }
        return .success(user.accessToken.tokenString)
    }

    /// Ошибка Google Sign-In → отказ с кодом.
    static func failure(of error: Error) -> Failure {
        let nsError = error as NSError
        if nsError.domain == kGIDSignInErrorDomain {
            switch GIDSignInError.Code(rawValue: nsError.code) {
            case .canceled:
                return Failure(code: "cancelled", message: "Вход отменён", error: error)
            case .hasNoAuthInKeychain:
                return Failure(code: "notSignedIn", message: "Вход в Google не выполнен", error: error)
            default:
                break
            }
        }
        return Failure(code: "authRequired", message: nsError.localizedDescription, error: error)
    }
}
