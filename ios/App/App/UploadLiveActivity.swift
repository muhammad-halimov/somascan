import ActivityKit
import Foundation

/**
 * Live Activity с ходом выгрузки (экран блокировки и Dynamic Island) — для iOS до 26: там нет
 * продолжаемой задачи системы, которая показывает ход сама (см. `UploadBackground`).
 *
 * Начинается, когда очередь взялась за пачку (бирку поставили с экрана — iOS запускает Live Activity
 * только у приложения на виду), обновляется вместе с «Загрузками» — полоса и проценты идут плавно
 * (плавный ход пачки от движка), а когда пачка дописана, на несколько секунд показывает итог
 * («Записано в таблицу: 3» или «Не всё записано») и уходит.
 *
 * Только на главном потоке.
 */
final class UploadLiveActivity {

    static let shared = UploadLiveActivity()

    /// Сколько держится итог пачки (как у уведомления Android).
    private static let resultShown: TimeInterval = 4
    /// Обновления не чаще раза в секунду: переходы между ними система анимирует сама, полоса идёт плавно.
    private static let minInterval: TimeInterval = 1

    private var activity: Activity<UploadActivityAttributes>?
    /// Идёт ли пачка (Live Activity с ходом показана или её не дали начать).
    private var inBatch = false
    private var shown: UploadActivityAttributes.ContentState?
    /// Обновления по очереди: каждое ждёт предыдущее.
    private var chain: Task<Void, Never>?
    /// Оставшиеся от прошлого запуска (приложение выгрузили посреди пачки) уже убраны.
    private var staleEnded = false
    /// Ход, ждущий своей очереди (см. `minInterval`), и когда было последнее обновление.
    private var pending: UploadActivityAttributes.ContentState?
    private var flushScheduled = false
    private var lastUpdate = Date.distantPast

    private init() {}

    /// Новая активность очереди от движка.
    func update(activity data: [String: Any]?, texts: UploadBackground.Texts) {
        if !staleEnded {
            staleEnded = true
            let stale = Activity<UploadActivityAttributes>.activities
            enqueue {
                for activity in stale {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
        }
        let busy = UploadEngine.isBusy(data)
        let progress = data?["progress"] as? [String: Any]
        let total = max(0, (progress?["total"] as? NSNumber)?.intValue ?? 0)
        let done = min(total, max(0, (progress?["done"] as? NSNumber)?.intValue ?? 0))
        // Плавный ход пачки от движка (0…1): полоса и проценты.
        let fraction = min(1, max(0, (progress?["fraction"] as? NSNumber)?.doubleValue ?? 0))
        if busy {
            guard total > 0 else { return }
            let state = UploadActivityAttributes.ContentState(
                done: done,
                total: total,
                fraction: fraction,
                counter: texts.percent(min(99, Int(fraction * 100))),
                finished: false,
                subtitle: texts.subtitle(total - done)
            )
            if !inBatch {
                inBatch = true
                start(state, title: texts.title)
            } else {
                apply(state)
            }
        } else if inBatch {
            inBatch = false
            guard let current = activity else { return }
            activity = nil
            shown = nil
            pending = nil
            let finished = data?["finished"] as? [String: Any]
            let finishedTotal = max(0, (finished?["total"] as? NSNumber)?.intValue ?? 0)
            let written = min(finishedTotal, max(0, (finished?["written"] as? NSNumber)?.intValue ?? 0))
            let complete = written == finishedTotal
            let state = UploadActivityAttributes.ContentState(
                done: written,
                total: finishedTotal,
                fraction: finishedTotal > 0 ? Double(written) / Double(finishedTotal) : 1,
                counter: complete ? texts.percent(100) : "\(written)/\(finishedTotal)",
                finished: true,
                subtitle: complete ? texts.done(written) : texts.attention
            )
            enqueue {
                await current.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(Self.resultShown)))
            }
        }
    }

    private func start(_ state: UploadActivityAttributes.ContentState, title: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        do {
            activity = try Activity.request(
                attributes: UploadActivityAttributes(title: title),
                content: ActivityContent(state: state, staleDate: nil),
                pushType: nil
            )
            shown = state
            lastUpdate = Date()
        } catch {
            // Приложение не на виду (пачку начала фоновая задача) или Live Activity выключены.
            NSLog("[UploadLiveActivity] request: %@", error.localizedDescription)
        }
    }

    private func apply(_ state: UploadActivityAttributes.ContentState) {
        guard activity != nil, state != shown else { return }
        pending = state
        guard !flushScheduled else { return }
        flushScheduled = true
        let wait = max(0, lastUpdate.addingTimeInterval(Self.minInterval).timeIntervalSinceNow)
        DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
            self?.flush()
        }
    }

    private func flush() {
        flushScheduled = false
        guard let activity, let state = pending, state != shown else { return }
        pending = nil
        shown = state
        lastUpdate = Date()
        enqueue {
            await activity.update(ActivityContent(state: state, staleDate: nil))
        }
    }

    private func enqueue(_ operation: @escaping @Sendable () async -> Void) {
        let previous = chain
        chain = Task {
            await previous?.value
            await operation()
        }
    }
}
