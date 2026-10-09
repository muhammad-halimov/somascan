import Foundation
import UIKit
import Capacitor
import AMSMB2

/**
 * Плагин «сетевой диск»: файловые операции на общей папке Windows для выгрузки таблицы
 * (аналог Android-плагина `SmbSharePlugin.java`).
 *
 * Операции выполняются по одной (`SmbShareClient`), не блокируя очередь моста Capacitor.
 * На время операции у системы запрашивается фоновое время (`beginBackgroundTask`), чтобы запись
 * дописалась, даже если пользователь свернул приложение.
 *
 * Операции — `SmbShareOps` (их же выполняет движок очереди); контракт (аргументы и коды ошибок)
 * описан в веб-части: `src/features/uploads/smb/smbFiles.ts`.
 */
@objc(SmbSharePlugin)
public class SmbSharePlugin: CAPInstancePlugin, CAPBridgedPlugin {
    public let identifier = "SmbSharePlugin"
    public let jsName = "SmbShare"
    public let pluginMethods: [CAPPluginMethod] = ["probe", "read", "write", "commit", "rename", "remove", "list", "mkdir", "mkdirs"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }

    private let client = SmbShareClient()

    @objc public func probe(_ call: CAPPluginCall) {
        perform(call, op: "probe")
    }

    @objc public func read(_ call: CAPPluginCall) {
        perform(call, op: "read")
    }

    @objc public func write(_ call: CAPPluginCall) {
        perform(call, op: "write")
    }

    @objc public func commit(_ call: CAPPluginCall) {
        perform(call, op: "commit")
    }

    @objc public func rename(_ call: CAPPluginCall) {
        perform(call, op: "rename")
    }

    @objc public func remove(_ call: CAPPluginCall) {
        perform(call, op: "remove")
    }

    @objc public func list(_ call: CAPPluginCall) {
        perform(call, op: "list")
    }

    @objc public func mkdir(_ call: CAPPluginCall) {
        perform(call, op: "mkdir")
    }

    @objc public func mkdirs(_ call: CAPPluginCall) {
        perform(call, op: "mkdirs")
    }

    /// Ставит операцию `op` (`SmbShareOps`) в очередь клиента и отвечает на вызов по её завершении.
    private func perform(_ call: CAPPluginCall, op: String) {
        guard let target = SmbShareClient.Target(call.getObject("connection")) else {
            call.reject("Нужны параметры подключения (connection)", "invalidArgs")
            return
        }
        let client = self.client
        let args = call.options as? [String: Any] ?? [:]
        Task.detached(priority: .utility) {
            let activity = await BackgroundActivity.begin()
            defer { Task { await activity.end() } }
            do {
                let result = try await client.perform(target) { manager in try await SmbShareOps.run(client, manager, op: op, args: args) }
                call.resolve(result)
            } catch let failure as SmbShareClient.Failure {
                call.reject(failure.message, failure.code)
            } catch {
                call.reject((error as NSError).localizedDescription, "io")
            }
        }
    }
}

/// Фоновое время на одну операцию: система даёт приложению доработать после сворачивания.
@MainActor
private final class BackgroundActivity {
    private var id: UIBackgroundTaskIdentifier = .invalid

    static func begin() -> BackgroundActivity {
        let activity = BackgroundActivity()
        activity.id = UIApplication.shared.beginBackgroundTask(withName: "SmbShare") { [weak activity] in
            activity?.end()
        }
        return activity
    }

    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}
