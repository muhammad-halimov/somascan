import Foundation
import Capacitor

/**
 * HTTP-запросы из нативной части с настоящей отменой — для серверов в локальной сети по `http://`
 * (LM Studio), которые WebView блокирует как смешанное содержимое (аналог Android-плагина).
 *
 * `cancel` отменяет задачу URLSession: соединение закрывается, и LM Studio, заметив разрыв,
 * останавливает генерацию ответа.
 */
@objc(NativeHttpPlugin)
public class NativeHttpPlugin: CAPInstancePlugin, CAPBridgedPlugin {
    public let identifier = "NativeHttpPlugin"
    public let jsName = "NativeHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private let session = URLSession(configuration: .ephemeral)
    private var tasks: [String: URLSessionDataTask] = [:]
    private var cancelled = Set<String>()
    private let lock = NSLock()

    @objc public func request(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("Нужны id и url", "invalidArgs")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = call.getString("method") ?? "GET"
        let timeoutMs = call.getInt("timeoutMs") ?? 0
        // 0 — без предела (локальная модель может отвечать минуты); иначе — заданный.
        request.timeoutInterval = timeoutMs > 0 ? TimeInterval(timeoutMs) / 1000 : 3600
        for (key, value) in call.getObject("headers") ?? [:] {
            if let value = value as? String { request.setValue(value, forHTTPHeaderField: key) }
        }
        if let body = call.getString("body") { request.httpBody = Data(body.utf8) }

        lock.lock()
        if cancelled.remove(id) != nil {
            lock.unlock()
            call.reject("Запрос отменён", "cancelled")
            return
        }
        let task = session.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            self.lock.lock()
            self.tasks.removeValue(forKey: id)
            let wasCancelled = self.cancelled.remove(id) != nil
            self.lock.unlock()
            if wasCancelled || (error as? URLError)?.code == .cancelled {
                call.reject("Запрос отменён", "cancelled")
                return
            }
            if let error {
                let code = (error as? URLError)?.code == .timedOut ? "timeout" : "network"
                call.reject(error.localizedDescription, code, error)
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            call.resolve(["status": status, "body": String(decoding: data ?? Data(), as: UTF8.self)])
        }
        tasks[id] = task
        lock.unlock()
        task.resume()
    }

    /// Прерывает запрос: задача отменяется, соединение закрывается.
    @objc public func cancel(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.resolve()
            return
        }
        lock.lock()
        cancelled.insert(id)
        let task = tasks[id]
        lock.unlock()
        task?.cancel()
        call.resolve()
    }
}
