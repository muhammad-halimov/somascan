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
 * Контракт (аргументы и коды ошибок) описан в веб-части: `src/features/uploads/smb/SmbShare.ts`.
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
        perform(call) { client, manager in
            try await client.probe(manager, path: try Self.path(call, "path"))
        }
    }

    @objc public func read(_ call: CAPPluginCall) {
        perform(call) { client, manager in
            ["data": try await client.read(manager, path: try Self.path(call, "path")).base64EncodedString()]
        }
    }

    @objc public func write(_ call: CAPPluginCall) {
        perform(call) { client, manager in
            try await client.write(manager, path: try Self.path(call, "path"), data: try Self.data(call, "data"))
            return [:]
        }
    }

    @objc public func commit(_ call: CAPPluginCall) {
        perform(call) { client, manager in
            try await client.commit(
                manager,
                path: try Self.path(call, "path"),
                data: try Self.data(call, "data"),
                backupPath: call.getString("backupPath").map(SmbShareClient.normalize)
            )
        }
    }

    @objc public func rename(_ call: CAPPluginCall) {
        perform(call) { client, manager in
            try await client.rename(manager, from: try Self.path(call, "from"), to: try Self.path(call, "to"))
            return [:]
        }
    }

    @objc public func remove(_ call: CAPPluginCall) {
        perform(call) { client, manager in
            try await client.remove(manager, path: try Self.path(call, "path"))
            return [:]
        }
    }

    @objc public func list(_ call: CAPPluginCall) {
        perform(call) { client, manager in
            ["entries": try await client.list(manager, path: try Self.path(call, "path"))]
        }
    }

    @objc public func mkdir(_ call: CAPPluginCall) {
        perform(call) { client, manager in
            try await client.mkdir(manager, path: try Self.path(call, "path"))
            return [:]
        }
    }

    @objc public func mkdirs(_ call: CAPPluginCall) {
        perform(call) { client, manager in
            try await client.mkdirs(manager, path: try Self.path(call, "path"))
            return [:]
        }
    }

    /// Ставит операцию в очередь клиента и отвечает на вызов по её завершении.
    private func perform(_ call: CAPPluginCall, _ body: @escaping @Sendable (SmbShareClient, SMB2Manager) async throws -> [String: Any]) {
        guard let target = SmbShareClient.Target(call.getObject("connection")) else {
            call.reject("Нужны параметры подключения (connection)", "invalidArgs")
            return
        }
        let client = self.client
        Task.detached(priority: .utility) {
            let activity = await BackgroundActivity.begin()
            defer { Task { await activity.end() } }
            do {
                let result = try await client.perform(target) { manager in try await body(client, manager) }
                call.resolve(result)
            } catch let failure as SmbShareClient.Failure {
                call.reject(failure.message, failure.code)
            } catch {
                call.reject((error as NSError).localizedDescription, "io")
            }
        }
    }

    /// Обязательный строковый аргумент.
    private static func string(_ call: CAPPluginCall, _ name: String) throws -> String {
        guard let value = call.getString(name) else {
            throw SmbShareClient.Failure(code: "invalidArgs", message: "Нужен аргумент \(name)")
        }
        return value
    }

    /// Обязательный путь без ведущих и конечных слэшей.
    private static func path(_ call: CAPPluginCall, _ name: String) throws -> String {
        SmbShareClient.normalize(try string(call, name))
    }

    /// Обязательные данные в base64.
    private static func data(_ call: CAPPluginCall, _ name: String) throws -> Data {
        guard let data = Data(base64Encoded: try string(call, name), options: .ignoreUnknownCharacters) else {
            throw SmbShareClient.Failure(code: "invalidArgs", message: "Данные не в base64")
        }
        return data
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
