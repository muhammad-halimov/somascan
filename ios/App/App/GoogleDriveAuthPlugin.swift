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
        guard configure(call) else { return }
        DispatchQueue.main.async {
            let refresh: (GIDGoogleUser) -> Void = { user in
                user.refreshTokensIfNeeded { refreshed, error in
                    if let error {
                        Self.reject(call, error)
                        return
                    }
                    Self.resolve(call, user: refreshed ?? user, scopes: scopes)
                }
            }
            if let user = GIDSignIn.sharedInstance.currentUser {
                refresh(user)
            } else if GIDSignIn.sharedInstance.hasPreviousSignIn() {
                GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in
                    if let user {
                        refresh(user)
                    } else {
                        call.reject(error?.localizedDescription ?? "Нужно войти в Google заново", "authRequired")
                    }
                }
            } else {
                call.reject("Вход в Google не выполнен", "notSignedIn")
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

    /**
     Настраивает SDK по Info.plist. Без client ID или без URL-схемы для обратного вызова
     SDK падает исключением, поэтому сначала проверяем и отвечаем `notConfigured`.
     */
    private func configure(_ call: CAPPluginCall) -> Bool {
        let clientID = (Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        guard !clientID.isEmpty else {
            call.reject("Вход через Google не настроен: в Info.plist нет GIDClientID", "notConfigured")
            return false
        }
        let reversed = clientID.components(separatedBy: ".").reversed().joined(separator: ".")
        let urlTypes = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] ?? []
        let schemes = urlTypes.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
        guard schemes.contains(where: { $0.caseInsensitiveCompare(reversed) == .orderedSame }) else {
            call.reject("Вход через Google не настроен: в URL-схемах нет \(reversed)", "notConfigured")
            return false
        }
        if GIDSignIn.sharedInstance.configuration?.clientID != clientID {
            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
        }
        return true
    }

    private static func resolve(_ call: CAPPluginCall, user: GIDGoogleUser, scopes: [String]) {
        let granted = Set(user.grantedScopes ?? [])
        guard scopes.allSatisfy({ granted.contains($0) }) else {
            call.reject("Нет доступа к Google Drive — войдите заново и разрешите доступ", "authRequired")
            return
        }
        call.resolve(["accessToken": user.accessToken.tokenString])
    }

    private static func reject(_ call: CAPPluginCall, _ error: Error) {
        let nsError = error as NSError
        if nsError.domain == kGIDSignInErrorDomain {
            switch GIDSignInError.Code(rawValue: nsError.code) {
            case .canceled:
                call.reject("Вход отменён", "cancelled", error)
                return
            case .hasNoAuthInKeychain:
                call.reject("Вход в Google не выполнен", "notSignedIn", error)
                return
            default:
                break
            }
        }
        call.reject(nsError.localizedDescription, "authRequired", error)
    }
}
