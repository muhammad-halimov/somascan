import Foundation
import CryptoKit
import AMSMB2

/**
 * Файловые операции на общей папке Windows (SMB 2/3) через AMSMB2 (libsmb2).
 *
 * Держит одно подключение на последние параметры и переподключается, если сервер закрыл сессию.
 * Операции выполняются строго по одной: каждая новая задача ждёт завершения предыдущей (`enqueue`),
 * поэтому параллельных обращений к серверу нет. Пути приходят через `/` относительно корня
 * общей папки — в этом же виде их принимает AMSMB2. Ошибки переводятся в `Failure` с кодом,
 * который понимает веб-часть (`UploadError`).
 */
final class SmbShareClient: @unchecked Sendable {

    /// Параметры подключения.
    struct Target: Equatable, Sendable {
        let host: String
        let port: Int
        let share: String
        let domain: String
        let username: String
        let password: String

        /// Читает параметры из аргумента `connection` вызова плагина.
        init?(_ object: [String: Any]?) {
            guard let object,
                  let host = (object["host"] as? String)?.trimmingCharacters(in: .whitespaces), !host.isEmpty,
                  let share = (object["share"] as? String)?.trimmingCharacters(in: .whitespaces), !share.isEmpty
            else { return nil }
            self.host = host
            self.port = (object["port"] as? NSNumber)?.intValue ?? 445
            self.share = share
            self.domain = object["domain"] as? String ?? ""
            self.username = object["username"] as? String ?? ""
            self.password = object["password"] as? String ?? ""
        }
    }

    /// Сбой с кодом для веб-части.
    struct Failure: Error {
        let code: String
        let message: String
    }

    /// Суффикс временного файла при атомарной замене.
    private static let tmpSuffix = ".tmp"

    private var manager: SMB2Manager?
    private var target: Target?
    /// Хвост цепочки задач: следующая операция ждёт его завершения.
    private var chain: Task<Void, Never> = Task {}
    private let chainLock = NSLock()

    // MARK: Очередь и подключение

    /// Выполняет операцию после всех поставленных раньше. Протухшее соединение пересоздаётся,
    /// и операция повторяется один раз.
    func perform<T: Sendable>(_ target: Target, _ operation: @escaping @Sendable (SMB2Manager) async throws -> T) async throws -> T {
        let task = enqueue { [self] () async throws -> T in
            do {
                return try await operation(try await open(target))
            } catch let failure as Failure {
                throw failure
            } catch {
                guard Self.isConnectionLoss(error) else { throw error }
                await disconnect()
                return try await operation(try await open(target))
            }
        }
        do {
            return try await task.value
        } catch {
            throw Self.translate(error)
        }
    }

    /// Закрывает подключение (если есть).
    func disconnect() async {
        if let manager {
            try? await manager.disconnectShare(gracefully: false)
        }
        manager = nil
        target = nil
    }

    /// Ставит задачу в хвост цепочки: она начнётся, когда завершится предыдущая.
    private func enqueue<T>(_ body: @escaping @Sendable () async throws -> T) -> Task<T, Error> {
        chainLock.lock()
        defer { chainLock.unlock() }
        let previous = chain
        let task = Task<T, Error> {
            _ = await previous.value
            return try await body()
        }
        chain = Task { _ = try? await task.value }
        return task
    }

    /// Текущее подключение с нужными параметрами или новое.
    private func open(_ target: Target) async throws -> SMB2Manager {
        if let manager, self.target == target {
            return manager
        }
        await disconnect()
        var components = URLComponents()
        components.scheme = "smb"
        components.host = target.host
        components.port = target.port
        guard let url = components.url,
              let manager = SMB2Manager(
                url: url,
                domain: target.domain,
                credential: URLCredential(user: target.username, password: target.password, persistence: .forSession)
              )
        else {
            throw Failure(code: "invalidArgs", message: "Некорректный адрес сервера: \(target.host)")
        }
        manager.timeout = 30
        do {
            try await manager.connectShare(name: target.share)
        } catch {
            throw Self.translateConnect(error)
        }
        self.manager = manager
        self.target = target
        return manager
    }

    // MARK: Операции

    /// Сведения о файле или папке; `exists: false`, если пути нет.
    func probe(_ manager: SMB2Manager, path: String) async throws -> [String: Any] {
        if path.isEmpty {
            return Self.stat(exists: true, isDirectory: true, size: 0, modifiedAt: 0)
        }
        do {
            return Self.stat(try await manager.attributesOfItem(atPath: path))
        } catch where Self.isNotFound(error) {
            return Self.stat(exists: false, isDirectory: false, size: 0, modifiedAt: 0)
        }
    }

    /// Содержимое файла.
    func read(_ manager: SMB2Manager, path: String) async throws -> Data {
        try await manager.contents(atPath: path, progress: nil)
    }

    /// Создаёт файл или перезаписывает: AMSMB2 пишет только в новый файл, поэтому старый сначала удаляется.
    func write(_ manager: SMB2Manager, path: String, data: Data) async throws {
        try await removeIfExists(manager, path: path)
        try await manager.write(data: data, toPath: path, progress: nil)
    }

    /**
     Атомарная замена файла: временный файл рядом → перечитать и сверить SHA-256 →
     прежний файл переименовать в резервную копию (или удалить, если копия не нужна) →
     временный переименовать в целевой → сверить размер.
     */
    func commit(_ manager: SMB2Manager, path: String, data: Data, backupPath: String?) async throws -> [String: Any] {
        let tmp = path + Self.tmpSuffix
        try await ensureParent(manager, path: path)
        try await write(manager, path: tmp, data: data)
        let hash = Self.sha256(data)
        guard Self.sha256(try await read(manager, path: tmp)) == hash else {
            try? await manager.removeItem(atPath: tmp)
            throw Failure(code: "verifyFailed", message: "Временный файл прочитан не таким, каким был записан")
        }
        if try await exists(manager, path: path) {
            if let backupPath, !backupPath.isEmpty {
                try await ensureParent(manager, path: backupPath)
                try await manager.moveItem(atPath: path, toPath: backupPath)
            } else {
                try await manager.removeItem(atPath: path)
            }
        }
        try await manager.moveItem(atPath: tmp, toPath: path)
        let size = (try await manager.attributesOfItem(atPath: path)[.fileSizeKey] as? NSNumber)?.int64Value ?? -1
        guard size == Int64(data.count) else {
            throw Failure(code: "verifyFailed", message: "Размер файла после замены не совпал: \(size) вместо \(data.count)")
        }
        return ["hash": hash, "size": size]
    }

    /// Переименовывает файл или папку; цель не должна существовать.
    func rename(_ manager: SMB2Manager, from: String, to: String) async throws {
        try await manager.moveItem(atPath: from, toPath: to)
    }

    /// Удаляет файл или папку со всем содержимым.
    func remove(_ manager: SMB2Manager, path: String) async throws {
        try await manager.removeItem(atPath: path)
    }

    /// Содержимое папки.
    func list(_ manager: SMB2Manager, path: String) async throws -> [[String: Any]] {
        try await manager.contentsOfDirectory(atPath: path, recursive: false).compactMap { entry in
            guard let name = entry[.nameKey] as? String, name != ".", name != ".." else { return nil }
            var item = Self.stat(entry)
            item["name"] = name
            item.removeValue(forKey: "exists")
            return item
        }
    }

    /// Создаёт одну папку; если она уже есть — ошибка `exists`.
    func mkdir(_ manager: SMB2Manager, path: String) async throws {
        try await manager.createDirectory(atPath: path)
    }

    /// Создаёт папку вместе с родительскими; существующие пропускает.
    func mkdirs(_ manager: SMB2Manager, path: String) async throws {
        var current = ""
        for segment in path.split(separator: "/") where !segment.isEmpty {
            current += (current.isEmpty ? "" : "/") + segment
            do {
                try await manager.createDirectory(atPath: current)
            } catch where Self.isAlreadyExists(error) {
                continue
            }
        }
    }

    // MARK: Вспомогательное

    /// Путь веб-части без ведущих и конечных слэшей.
    static func normalize(_ path: String) -> String {
        path.replacingOccurrences(of: "\\", with: "/").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private func exists(_ manager: SMB2Manager, path: String) async throws -> Bool {
        (try await probe(manager, path: path)["exists"] as? Bool) ?? false
    }

    private func removeIfExists(_ manager: SMB2Manager, path: String) async throws {
        do {
            try await manager.removeItem(atPath: path)
        } catch where Self.isNotFound(error) {
            return
        }
    }

    /// Создаёт папку файла, если её нет.
    private func ensureParent(_ manager: SMB2Manager, path: String) async throws {
        guard let slash = path.lastIndex(of: "/") else { return }
        try await mkdirs(manager, path: String(path[..<slash]))
    }

    private static func stat(_ attributes: [URLResourceKey: Any]) -> [String: Any] {
        let isDirectory = (attributes[.fileResourceTypeKey] as? URLFileResourceType) == .directory
            || (attributes[.isDirectoryKey] as? Bool) == true
        let size = (attributes[.fileSizeKey] as? NSNumber)?.int64Value ?? 0
        let modifiedAt = (attributes[.contentModificationDateKey] as? Date).map { Int64($0.timeIntervalSince1970 * 1000) } ?? 0
        return stat(exists: true, isDirectory: isDirectory, size: size, modifiedAt: modifiedAt)
    }

    private static func stat(exists: Bool, isDirectory: Bool, size: Int64, modifiedAt: Int64) -> [String: Any] {
        ["exists": exists, "isDirectory": isDirectory, "size": size, "modifiedAt": modifiedAt]
    }

    private static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Текст ошибки: описание и причина (AMSMB2 кладёт текст libsmb2 в причину).
    private static func describe(_ error: Error) -> String {
        let nsError = error as NSError
        return [nsError.localizedDescription, nsError.localizedFailureReason].compactMap { $0 }.joined(separator: " — ")
    }

    /**
     Путь уже существует. libsmb2 создаёт и удаляет папки и файлы составным запросом «открыть + закрыть»:
     если открытие отклонено (`STATUS_OBJECT_NAME_COLLISION`), код ошибки берётся у закрытия —
     `ENETRESET` («соединение сброшено»), а настоящий статус остаётся только в тексте. Поэтому смотрим и на текст.
     */
    private static func isAlreadyExists(_ error: Error) -> Bool {
        if let posix = error as? POSIXError, posix.code == .EEXIST { return true }
        return describe(error).uppercased().contains("OBJECT_NAME_COLLISION")
    }

    /// Пути нет — по коду `ENOENT` или, как с `isAlreadyExists`, по статусу SMB в тексте ошибки.
    private static func isNotFound(_ error: Error) -> Bool {
        if let posix = error as? POSIXError, posix.code == .ENOENT { return true }
        let text = describe(error).uppercased()
        return ["OBJECT_NAME_NOT_FOUND", "OBJECT_PATH_NOT_FOUND", "NO_SUCH_FILE"].contains { text.contains($0) }
    }

    /// Ошибки, после которых стоит пересоздать подключение и повторить операцию.
    private static func isConnectionLoss(_ error: Error) -> Bool {
        // Ответ сервера «уже есть» / «нет такого пути» — не обрыв, даже если код ENETRESET.
        if isAlreadyExists(error) || isNotFound(error) { return false }
        guard let posix = error as? POSIXError else { return false }
        switch posix.code {
        case .ENOTCONN, .ECONNRESET, .EPIPE, .ECONNABORTED, .EBADF, .ENETDOWN, .ENETRESET, .EIO:
            return true
        default:
            return false
        }
    }

    /// Переводит ошибку операции в `Failure` с кодом для веб-части (коды errno — из libsmb2).
    static func translate(_ error: Error) -> Failure {
        if let failure = error as? Failure {
            return failure
        }
        let message = describe(error)
        if isAlreadyExists(error) {
            return Failure(code: "exists", message: message)
        }
        if isNotFound(error) {
            return Failure(code: "notFound", message: message)
        }
        guard let posix = error as? POSIXError else {
            return Failure(code: "io", message: message)
        }
        switch posix.code {
        case .EACCES, .EPERM:
            return Failure(code: "accessDenied", message: message)
        case .ETXTBSY, .EDEADLK, .EBUSY, .EAGAIN:
            return Failure(code: "locked", message: message)
        case .ETIMEDOUT:
            return Failure(code: "timeout", message: message)
        case .ECONNREFUSED, .EHOSTUNREACH, .ENETUNREACH, .ENETDOWN, .EHOSTDOWN, .ECONNRESET, .ECONNABORTED, .ENOTCONN, .EPIPE:
            return Failure(code: "hostUnreachable", message: message)
        default:
            return Failure(code: "io", message: message)
        }
    }

    /// Ошибка на этапе подключения: ENOENT — нет такой общей папки, EACCES и отказ входа — учётная запись.
    static func translateConnect(_ error: Error) -> Failure {
        if let failure = error as? Failure {
            return failure
        }
        let message = describe(error)
        guard let posix = error as? POSIXError else {
            return Failure(code: "hostUnreachable", message: message)
        }
        switch posix.code {
        case .ENOENT:
            return Failure(code: "shareNotFound", message: message)
        case .EACCES, .EPERM:
            return Failure(code: "authFailed", message: message)
        case .ECONNREFUSED:
            // libsmb2 переводит STATUS_LOGON_FAILURE в ECONNREFUSED — отличаем от закрытого порта по тексту.
            let text = message.uppercased()
            let isLogon = text.contains("LOGON") || text.contains("SESSION SETUP") || text.contains("AUTHENTICATION")
            return Failure(code: isLogon ? "authFailed" : "hostUnreachable", message: message)
        case .ETIMEDOUT:
            return Failure(code: "timeout", message: message)
        default:
            return Failure(code: "hostUnreachable", message: message)
        }
    }
}
