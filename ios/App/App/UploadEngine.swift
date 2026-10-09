import Foundation
import JavaScriptCore
import Network
import AMSMB2

/**
 * Движок очереди выгрузки: `public/upload-engine.js` (веб-часть, `src/engine`) в JavaScriptCore —
 * вне WKWebView экрана. WKWebView приостанавливает страницу вскоре после сворачивания, поэтому
 * очередь на экране замирала и дописывалась только при возврате; движок же работает, пока у
 * приложения есть фоновое время (`UploadBackground`), и продолжает с сохранённой очереди после
 * перезапуска. Экран — только окно в очередь: команды и снимки идут через `UploadEnginePlugin`.
 *
 * Хост движка (`SomascanHost`): хранилище «ключ — значение» в файлах приложения, таймеры, сетевой
 * диск (`SmbShareOps`), HTTP для Google Drive, токен Google (`GoogleDriveTokens`), события и журнал.
 * Протокол — `src/engine/protocol.ts`. Весь доступ к JSContext — из одной очереди `queue`.
 */
final class UploadEngine: @unchecked Sendable {

    static let shared = UploadEngine()

    /// Ключ очереди в хранилище движка (как у `UploadStore`).
    static let queueKey = "somascan.uploads.v2"

    private let queue = DispatchQueue(label: "com.somascan.app.upload-engine")
    private let smb = SmbShareClient()
    private let storageLock = NSLock()
    private let storageDir: URL
    private let pathMonitor = NWPathMonitor()

    // Только из `queue`.
    private var context: JSContext?
    private var ready = false
    private var pendingCommands: [String] = []
    private var timers = Set<Int>()

    // Из любого потока под `stateLock`.
    private let stateLock = NSLock()
    private var cachedState: String?
    private var cachedActivity: [String: Any]?
    private var listeners: [UUID: (state: ((String) -> Void)?, activity: (([String: Any]) -> Void)?)] = [:]

    private init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        storageDir = base.appendingPathComponent("upload-engine", isDirectory: true)
    }

    // MARK: Управление

    /// Запускает движок (если ещё не запущен).
    func start() {
        queue.async { self.startOnQueue() }
    }

    /// Команда движку (JSON `EngineCommand`); до загрузки движка команды копятся.
    func command(_ json: String) {
        queue.async {
            self.startOnQueue()
            if self.ready {
                _ = self.context?.objectForKeyedSubscript("SomascanEngine")?.invokeMethod("command", withArguments: [json])
            } else {
                self.pendingCommands.append(json)
            }
        }
    }

    /// Команда движку из словаря.
    func command(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object), let json = String(data: data, encoding: .utf8) else { return }
        command(json)
    }

    /// Последний снимок очереди (JSON-массив записей).
    var lastState: String {
        stateLock.lock()
        let state = cachedState
        stateLock.unlock()
        return state ?? readStorage(Self.queueKey) ?? "[]"
    }

    /// Последняя активность очереди или `nil`, пока движок её не сообщил.
    var lastActivity: [String: Any]? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return cachedActivity
    }

    /// Подписка на снимки и активность (вызываются не на главном потоке); возвращает id для отписки.
    @discardableResult
    func addListener(state: ((String) -> Void)? = nil, activity: (([String: Any]) -> Void)? = nil) -> UUID {
        let id = UUID()
        stateLock.lock()
        listeners[id] = (state, activity)
        stateLock.unlock()
        return id
    }

    func removeListener(_ id: UUID) {
        stateLock.lock()
        listeners[id] = nil
        stateLock.unlock()
    }

    /// Занята ли очередь: пишет или есть что писать при наличии сети (как `isBusy` в протоколе).
    static func isBusy(_ activity: [String: Any]?) -> Bool {
        guard let activity else { return false }
        let running = activity["running"] as? Bool ?? false
        let online = activity["online"] as? Bool ?? true
        let due = (activity["due"] as? NSNumber)?.intValue ?? 0
        return running || (online && due > 0)
    }

    // MARK: JSContext

    private func startOnQueue() {
        guard context == nil else { return }
        guard let url = Bundle.main.url(forResource: "upload-engine", withExtension: "js", subdirectory: "public"),
              let source = try? String(contentsOf: url, encoding: .utf8),
              let context = JSContext() else {
            NSLog("[UploadEngine] engine script is missing (run npm run build && npx cap sync ios)")
            return
        }
        context.name = "Somascan upload engine"
        context.exceptionHandler = { _, exception in
            NSLog("[UploadEngine] JS exception: %@", exception?.toString() ?? "?")
        }
        context.setObject(makeHost(in: context), forKeyedSubscript: "SomascanHost" as NSString)
        self.context = context
        watchNetwork()
        context.evaluateScript(source, withSourceURL: url)
    }

    /// Объект `SomascanHost` (методы вызываются из JS на `queue`).
    private func makeHost(in context: JSContext) -> JSValue {
        let host = JSValue(newObjectIn: context)!
        let storageGet: @convention(block) (String) -> Any = { [weak self] key in
            if let value = self?.readStorage(key) {
                return value
            }
            return NSNull()
        }
        let storageSet: @convention(block) (String, String) -> Void = { [weak self] key, value in
            self?.writeStorage(key, value)
        }
        let storageRemove: @convention(block) (String) -> Void = { [weak self] key in
            self?.removeStorage(key)
        }
        let call: @convention(block) (Int, String, String) -> Void = { [weak self] id, method, args in
            self?.perform(id: id, method: method, argsJson: args)
        }
        let emit: @convention(block) (String, String) -> Void = { [weak self] type, payload in
            self?.onEvent(type: type, payload: payload)
        }
        let log: @convention(block) (String, String) -> Void = { level, message in
            NSLog("[UploadEngine] %@: %@", level, message)
        }
        let setTimer: @convention(block) (Int, Double) -> Void = { [weak self] id, delay in
            guard let self else { return }
            self.timers.insert(id)
            self.queue.asyncAfter(deadline: .now() + max(0, delay) / 1000) { [weak self] in
                guard let self, self.timers.remove(id) != nil else { return }
                _ = self.context?.objectForKeyedSubscript("__somascanTimer")?.call(withArguments: [id])
            }
        }
        let clearTimer: @convention(block) (Int) -> Void = { [weak self] id in
            self?.timers.remove(id)
        }
        host.setObject(storageGet, forKeyedSubscript: "storageGet" as NSString)
        host.setObject(storageSet, forKeyedSubscript: "storageSet" as NSString)
        host.setObject(storageRemove, forKeyedSubscript: "storageRemove" as NSString)
        host.setObject(call, forKeyedSubscript: "call" as NSString)
        host.setObject(emit, forKeyedSubscript: "emit" as NSString)
        host.setObject(log, forKeyedSubscript: "log" as NSString)
        host.setObject(setTimer, forKeyedSubscript: "setTimer" as NSString)
        host.setObject(clearTimer, forKeyedSubscript: "clearTimer" as NSString)
        return host
    }

    /// Ответ на долгую операцию — в движок (на `queue`).
    private func settle(_ id: Int, ok: Bool, payload: [String: Any]) {
        let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
        let json = String(data: data, encoding: .utf8) ?? "{}"
        queue.async {
            _ = self.context?.objectForKeyedSubscript("__somascanSettle")?.call(withArguments: [id, ok, json])
        }
    }

    private static func failure(_ code: String, _ message: String) -> [String: Any] {
        ["code": code, "message": message]
    }

    // MARK: События движка

    private func onEvent(type: String, payload: String) {
        guard let data = payload.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        switch type {
        case "ready":
            ready = true
            let commands = pendingCommands
            pendingCommands.removeAll()
            for json in commands {
                _ = context?.objectForKeyedSubscript("SomascanEngine")?.invokeMethod("command", withArguments: [json])
            }
        case "state":
            guard let records = object["records"],
                  let recordsData = try? JSONSerialization.data(withJSONObject: records),
                  let json = String(data: recordsData, encoding: .utf8) else { return }
            stateLock.lock()
            cachedState = json
            let callbacks = listeners.values.compactMap { $0.state }
            stateLock.unlock()
            callbacks.forEach { $0(json) }
        case "activity":
            guard let activity = object["activity"] as? [String: Any] else { return }
            stateLock.lock()
            cachedActivity = activity
            let callbacks = listeners.values.compactMap { $0.activity }
            stateLock.unlock()
            callbacks.forEach { $0(activity) }
            UploadBackground.shared.update(activity)
        default:
            break
        }
    }

    // MARK: Долгие операции

    private func perform(id: Int, method: String, argsJson: String) {
        let args = (argsJson.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }) ?? [:]
        switch method {
        case "smb":
            guard let target = SmbShareClient.Target(args["connection"] as? [String: Any]), let op = args["op"] as? String else {
                settle(id, ok: false, payload: Self.failure("invalidArgs", "Нужны параметры подключения и операция"))
                return
            }
            let client = smb
            Task.detached(priority: .utility) { [weak self] in
                do {
                    let result = try await client.perform(target) { manager in try await SmbShareOps.run(client, manager, op: op, args: args) }
                    self?.settle(id, ok: true, payload: result)
                } catch let failure as SmbShareClient.Failure {
                    self?.settle(id, ok: false, payload: Self.failure(failure.code, failure.message))
                } catch {
                    self?.settle(id, ok: false, payload: Self.failure("io", (error as NSError).localizedDescription))
                }
            }
        case "http":
            http(args) { [weak self] ok, payload in self?.settle(id, ok: ok, payload: payload) }
        case "googleToken":
            GoogleDriveTokens.fetch(scopes: [GoogleDriveTokens.driveScope]) { [weak self] result in
                switch result {
                case .success(let token):
                    self?.settle(id, ok: true, payload: ["accessToken": token])
                case .failure(let failure):
                    self?.settle(id, ok: false, payload: Self.failure(failure.code, failure.message))
                }
            }
        default:
            settle(id, ok: false, payload: Self.failure("io", "Неизвестная операция хоста \(method)"))
        }
    }

    /// HTTP-запрос для Google Drive: тело запроса и ответа — base64.
    private func http(_ args: [String: Any], completion: @escaping (Bool, [String: Any]) -> Void) {
        guard let string = args["url"] as? String, let url = URL(string: string) else {
            completion(false, Self.failure("network", "Нет адреса запроса"))
            return
        }
        var request = URLRequest(url: url, timeoutInterval: 120)
        request.httpMethod = args["method"] as? String ?? "GET"
        for (key, value) in args["headers"] as? [String: String] ?? [:] {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if let body = args["body"] as? String, !body.isEmpty {
            request.httpBody = Data(base64Encoded: body, options: .ignoreUnknownCharacters)
        }
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                completion(false, Self.failure("network", error.localizedDescription))
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            completion(true, ["status": status, "body": (data ?? Data()).base64EncodedString()])
        }.resume()
    }

    // MARK: Хранилище

    private func storageURL(_ key: String) -> URL {
        let safe = key.map { $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" || $0 == "_" ? String($0) : "_" }.joined()
        return storageDir.appendingPathComponent("\(safe).json")
    }

    func readStorage(_ key: String) -> String? {
        storageLock.lock()
        defer { storageLock.unlock() }
        return try? String(contentsOf: storageURL(key), encoding: .utf8)
    }

    private func writeStorage(_ key: String, _ value: String) {
        storageLock.lock()
        defer { storageLock.unlock() }
        do {
            try FileManager.default.createDirectory(at: storageDir, withIntermediateDirectories: true)
            // Атомарно и без защиты «до первой разблокировки»: фоновая задача может прийти при заблокированном экране.
            try Data(value.utf8).write(to: storageURL(key), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            NSLog("[UploadEngine] storage write %@: %@", key, error.localizedDescription)
        }
    }

    private func removeStorage(_ key: String) {
        storageLock.lock()
        defer { storageLock.unlock() }
        try? FileManager.default.removeItem(at: storageURL(key))
    }

    // MARK: Сеть

    /// Сообщает движку о сети: с её возвращением паузы снимаются, очередь идёт сразу.
    private func watchNetwork() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            self?.command(["type": "network", "online": path.status == .satisfied])
        }
        pathMonitor.start(queue: DispatchQueue(label: "com.somascan.app.upload-engine.network"))
    }
}
