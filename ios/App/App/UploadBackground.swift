import Foundation
import UIKit
import BackgroundTasks

/**
 * Фоновое время для движка очереди (`UploadEngine`) на iOS.
 *
 * - Пока очередь занята, приложение держит фоновую задачу (`beginBackgroundTask`): запись,
 *   начатая на экране, дописывается после сворачивания (система даёт на это обычно до ~30 с).
 * - iOS 26+: бирка, поставленная в очередь с экрана, запускает «продолжаемую» задачу
 *   (`BGContinuedProcessingTask`) — система показывает её прогресс (обработано из всех, по ходу
 *   пачки от движка) и «Осталось записать: N», а очередь пишется в свёрнутом приложении столько,
 *   сколько нужно.
 * - До iOS 26 ход пачки показывает Live Activity (`UploadLiveActivity`): экран блокировки
 *   и Dynamic Island, синхронно с «Загрузками», в конце — итог пачки.
 * - Если записи ждут сети или паузы после сбоя (или фоновое время кончилось), планируются фоновые
 *   задачи системы (`BGAppRefreshTask`, `BGProcessingTask` с условием «есть сеть»): система запускает
 *   приложение в фоне, движок поднимается и продолжает с сохранённой очереди.
 *
 * Ограничение iOS: приложение, которое пользователь закрыл смахиванием из переключателя, система
 * в фоне не запускает — очередь продолжится при следующем открытии.
 *
 * Состояние — только на главном потоке.
 */
final class UploadBackground: @unchecked Sendable {

    static let shared = UploadBackground()

    /// Идентификаторы задач (перечислены в Info.plist, `BGTaskSchedulerPermittedIdentifiers`).
    static let refreshTaskID = "com.somascan.app.uploads.refresh"
    static let processingTaskID = "com.somascan.app.uploads.processing"
    static let continuedTaskPrefix = "com.somascan.app.uploads.continued"

    /// Тексты для системы на языке приложения (присылает экран, см. `UploadEnginePlugin`).
    static let textsKey = "somascan.uploadEngine.texts"

    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var activity: [String: Any]?
    private var sequence = 0
    /// Фоновые задачи, ждущие, пока очередь перестанет быть занятой (после своего `kick`).
    private var waiters: [(after: Int, done: () -> Void)] = []
    /// Идущая продолжаемая задача (iOS 26+) и ожидание её запуска.
    private var continuedTask: AnyObject?
    private var continuedRequested = false

    private init() {}

    // MARK: Жизненный цикл

    /// Регистрирует фоновые задачи. Вызывается до конца запуска приложения (`didFinishLaunching`).
    func registerTasks() {
        for identifier in [Self.refreshTaskID, Self.processingTaskID] {
            _ = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { [weak self] task in
                self?.run(task)
            }
        }
    }

    /// Приложение ушло в фон: если очередь ещё пишется — нужна фоновая задача, если ждёт — расписание.
    func didEnterBackground() {
        DispatchQueue.main.async {
            if UploadEngine.isBusy(self.activity) {
                self.beginBackgroundTask()
            }
            self.scheduleLater()
        }
    }

    /// Приложение вернулось на экран: движок проверяет очередь.
    func willEnterForeground() {
        UploadEngine.shared.command(["type": "kick"])
    }

    /// Пользователь поставил бирку в очередь или повторил запись (экран на виду).
    func userStartedUpload() {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            DispatchQueue.main.async { self.submitContinued() }
        }
        #endif
    }

    /// Новая активность очереди от движка (любой поток).
    func update(_ activity: [String: Any]) {
        DispatchQueue.main.async {
            self.activity = activity
            self.sequence += 1
            let busy = UploadEngine.isBusy(activity)
            if busy {
                self.beginBackgroundTask()
            } else {
                let ready = self.waiters.filter { $0.after < self.sequence }
                self.waiters.removeAll { $0.after < self.sequence }
                ready.forEach { $0.done() }
                self.scheduleLater()
                self.endBackgroundTask()
            }
            if Self.usesContinuedTask {
                #if compiler(>=6.2)
                if #available(iOS 26.0, *) {
                    self.updateContinued()
                }
                #endif
            } else {
                UploadLiveActivity.shared.update(activity: activity, texts: Self.texts())
            }
        }
    }

    /// Ход выгрузки показывает продолжаемая задача системы (iOS 26+), а не Live Activity.
    private static var usesContinuedTask: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            return true
        }
        #endif
        return false
    }

    // MARK: Фоновая задача приложения

    private func beginBackgroundTask() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "SomascanUploads") { [weak self] in
            // Время вышло: остаток допишут фоновые задачи системы.
            self?.scheduleLater()
            self?.endBackgroundTask()
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    // MARK: Фоновые задачи системы

    /// Задача системы: поднять движок, дописать готовое и завершиться.
    private func run(_ task: BGTask) {
        var finished = false
        let finish: (Bool) -> Void = { [weak self] success in
            guard !finished else { return }
            finished = true
            task.setTaskCompleted(success: success)
            self?.scheduleLater()
        }
        task.expirationHandler = {
            DispatchQueue.main.async { finish(false) }
        }
        waiters.append((after: sequence, done: { finish(true) }))
        UploadEngine.shared.start()
        UploadEngine.shared.command(["type": "kick"])
    }

    /// Планирует следующий запуск в фоне, если в очереди остались записи.
    private func scheduleLater() {
        guard pendingCount > 0 else { return }
        let next = (activity?["nextAttemptAt"] as? NSNumber)?.doubleValue
        let start = next.map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date(timeIntervalSinceNow: 60)
        let refresh = BGAppRefreshTaskRequest(identifier: Self.refreshTaskID)
        refresh.earliestBeginDate = start
        let processing = BGProcessingTaskRequest(identifier: Self.processingTaskID)
        processing.requiresNetworkConnectivity = true
        processing.requiresExternalPower = false
        processing.earliestBeginDate = start
        for request in [refresh, processing] as [BGTaskRequest] {
            do {
                try BGTaskScheduler.shared.submit(request)
            } catch {
                NSLog("[UploadBackground] submit %@: %@", request.identifier, error.localizedDescription)
            }
        }
    }

    private var pendingCount: Int {
        (activity?["pending"] as? NSNumber)?.intValue ?? 0
    }

    /// Ход текущей пачки от движка: обработано из всех (`0 / 0` в покое) и плавный ход пачки (0…1).
    private var progress: (done: Int, total: Int, fraction: Double) {
        let value = activity?["progress"] as? [String: Any]
        let total = max(0, (value?["total"] as? NSNumber)?.intValue ?? 0)
        let done = min(total, max(0, (value?["done"] as? NSNumber)?.intValue ?? 0))
        let fraction = min(1, max(0, (value?["fraction"] as? NSNumber)?.doubleValue ?? 0))
        return (done, total, fraction)
    }

    /// Делений системного прогресса на бирку: полоса движется плавно и внутри записи одной бирки.
    private static let unitsPerRecord: Int64 = 100

    // MARK: Продолжаемая задача (iOS 26+)

    #if compiler(>=6.2)
    @available(iOS 26.0, *)
    private func submitContinued() {
        guard continuedTask == nil, !continuedRequested else { return }
        let identifier = "\(Self.continuedTaskPrefix).\(UUID().uuidString)"
        _ = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { [weak self] task in
            guard let self, let continued = task as? BGContinuedProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            self.runContinued(continued)
        }
        let texts = Self.texts()
        let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: texts.title, subtitle: texts.subtitle(max(1, pendingCount)))
        do {
            try BGTaskScheduler.shared.submit(request)
            continuedRequested = true
        } catch {
            NSLog("[UploadBackground] continued task: %@", error.localizedDescription)
        }
    }

    @available(iOS 26.0, *)
    private func runContinued(_ task: BGContinuedProcessingTask) {
        continuedRequested = false
        continuedTask = task
        let current = progress
        task.progress.totalUnitCount = Int64(max(1, current.total > 0 ? current.total : pendingCount)) * Self.unitsPerRecord
        task.progress.completedUnitCount = Int64((current.fraction * Double(task.progress.totalUnitCount)).rounded())
        task.expirationHandler = { [weak self] in
            DispatchQueue.main.async { self?.finishContinued(success: false) }
        }
        UploadEngine.shared.command(["type": "kick"])
    }

    /// Системный прогресс задачи — ход пачки от движка (тот же, что в уведомлении Android).
    @available(iOS 26.0, *)
    private func updateContinued() {
        guard let task = continuedTask as? BGContinuedProcessingTask else { return }
        let texts = Self.texts()
        guard UploadEngine.isBusy(activity) else {
            // Пачка дописана: полоса — до конца, задача завершается.
            task.progress.completedUnitCount = task.progress.totalUnitCount
            finishContinued(success: pendingCount == 0)
            return
        }
        let current = progress
        if current.total > 0 {
            task.progress.totalUnitCount = Int64(current.total) * Self.unitsPerRecord
            task.progress.completedUnitCount = Int64((current.fraction * Double(task.progress.totalUnitCount)).rounded())
        }
        task.updateTitle(texts.title, subtitle: texts.subtitle(current.total > 0 ? current.total - current.done : pendingCount))
    }

    @available(iOS 26.0, *)
    private func finishContinued(success: Bool) {
        (continuedTask as? BGContinuedProcessingTask)?.setTaskCompleted(success: success)
        continuedTask = nil
    }
    #endif

    // MARK: Тексты

    struct Texts {
        let title: String
        let pending: String
        let waiting: String
        /// Пачка записана целиком (`{count}` — сколько).
        let doneTemplate: String
        /// В пачке есть незаписанные.
        let attention: String
        /// Процент хода (`{percent}` — число), по языку приложения: «42%», «42 %».
        let percentTemplate: String

        func subtitle(_ count: Int) -> String {
            count > 0 ? pending.replacingOccurrences(of: "{count}", with: String(count)) : waiting
        }

        func done(_ count: Int) -> String {
            doneTemplate.replacingOccurrences(of: "{count}", with: String(count))
        }

        func percent(_ value: Int) -> String {
            percentTemplate.replacingOccurrences(of: "{percent}", with: String(value))
        }
    }

    static func texts() -> Texts {
        let stored = UserDefaults.standard.dictionary(forKey: textsKey) as? [String: String] ?? [:]
        return Texts(
            title: stored["title"] ?? "Выгрузка в таблицу",
            pending: stored["pending"] ?? "Осталось записать: {count}",
            waiting: stored["waiting"] ?? "Ждёт сети или повтора",
            doneTemplate: stored["done"] ?? "Записано в таблицу: {count}",
            attention: stored["attention"] ?? "Не всё записано — подробности в «Загрузках»",
            percentTemplate: stored["percent"] ?? "{percent}%"
        )
    }
}
