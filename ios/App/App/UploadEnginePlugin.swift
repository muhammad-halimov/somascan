import ActivityKit
import Capacitor
import Foundation
import UIKit

/**
 * Окно экрана в очередь выгрузки (аналог Android-плагина `UploadEnginePlugin.java`): команды движку
 * `UploadEngine`, снимки очереди обратно (событие `state`), настройки хранилища и тексты для системы
 * на языке приложения.
 *
 * Сам экран очередь не пишет — это делает движок вне WKWebView, поэтому записи доходят до таблицы
 * и в свёрнутом приложении. Контракт — `src/features/uploads/queue/NativeUploadQueue.ts`.
 */
@objc(UploadEnginePlugin)
public class UploadEnginePlugin: CAPInstancePlugin, CAPBridgedPlugin {
    public let identifier = "UploadEnginePlugin"
    public let jsName = "UploadEngine"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "command", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notificationStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openNotificationSettings", returnType: CAPPluginReturnPromise)
    ]

    private var listenerID: UUID?

    override public func load() {
        listenerID = UploadEngine.shared.addListener(state: { [weak self] json in
            guard let records = Self.records(json) else { return }
            DispatchQueue.main.async {
                self?.notifyListeners("state", data: ["records": records])
            }
        })
        UploadEngine.shared.start()
    }

    deinit {
        if let listenerID {
            UploadEngine.shared.removeListener(listenerID)
        }
    }

    /// Настройки хранилища и id устройства — движку; тексты — для фоновой задачи системы.
    @objc public func configure(_ call: CAPPluginCall) {
        guard let storage = call.getObject("storage") else {
            call.reject("Нужны настройки хранилища (storage)", "invalidArgs")
            return
        }
        let texts = call.getObject("texts") ?? [:]
        UserDefaults.standard.set([
            "title": texts["title"] as? String ?? "Выгрузка в таблицу",
            "pending": texts["pending"] as? String ?? "Осталось записать: {count}",
            "waiting": texts["waiting"] as? String ?? "Ждёт сети или повтора",
            "done": texts["done"] as? String ?? "Записано в таблицу: {count}",
            "attention": texts["attention"] as? String ?? "Не всё записано — подробности в «Загрузках»",
            "percent": texts["percent"] as? String ?? "{percent}%"
        ], forKey: UploadBackground.textsKey)
        UploadEngine.shared.command(["type": "configure", "storage": storage, "deviceId": call.getString("deviceId") ?? ""])
        call.resolve()
    }

    /// Команда движку; если появилось что писать — система получает продолжаемую задачу (iOS 26+).
    @objc public func command(_ call: CAPPluginCall) {
        guard let command = call.getObject("command") else {
            call.reject("Нужна команда (command)", "invalidArgs")
            return
        }
        UploadEngine.shared.command(command as [String: Any])
        let type = command["type"] as? String ?? ""
        if ["enqueue", "import", "retry", "retryAll"].contains(type) {
            UploadBackground.shared.userStartedUpload()
        }
        call.resolve()
    }

    /// Последний снимок очереди.
    @objc public func getState(_ call: CAPPluginCall) {
        call.resolve(["records": Self.records(UploadEngine.shared.lastState) ?? []])
    }

    /// На iOS отдельное разрешение не нужно: ход выгрузки показывает сама система.
    @objc public func requestNotifications(_ call: CAPPluginCall) {
        call.resolve(["granted": true])
    }

    /// Виден ли ход выгрузки в системе: до iOS 26 — включены ли Live Activity приложения
    /// (на iOS 26+ ход показывает продолжаемая задача, её не выключают).
    @objc public func notificationStatus(_ call: CAPPluginCall) {
        var enabled = ActivityAuthorizationInfo().areActivitiesEnabled
        if #available(iOS 26.0, *) {
            enabled = true
        }
        call.resolve(["enabled": enabled])
    }

    /// Настройки приложения (там же — переключатель Live Activity).
    @objc public func openNotificationSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("Не удалось открыть настройки", "unavailable")
                return
            }
            UIApplication.shared.open(url)
            call.resolve()
        }
    }

    private static func records(_ json: String) -> [Any]? {
        guard let data = json.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [Any]
    }
}
