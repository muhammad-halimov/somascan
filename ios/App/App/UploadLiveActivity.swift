import ActivityKit
import Foundation

/**
 * Live Activity с ходом выгрузки (экран блокировки и Dynamic Island) — для iOS до 26: там нет
 * продолжаемой задачи системы, которая показывает ход сама (см. `UploadBackground`).
 *
 * Начинается, когда очередь взялась за пачку (бирку поставили с экрана — iOS запускает Live Activity
 * только у приложения на виду), обновляется вместе с «Загрузками» — полоса движется по шагам
 * записи каждой бирки, а когда пачка дописана, на несколько секунд показывает итог («Записано
 * в таблицу: 3» или «Не всё записано») и уходит.
 *
 * Только на главном потоке.
 */
final class UploadLiveActivity {

    static let shared = UploadLiveActivity()

    /// Сколько держится итог пачки (как у уведомления Android).
    private static let resultShown: TimeInterval = 4

    private var activity: Activity<UploadActivityAttributes>?
    /// Идёт ли пачка (Live Activity с ходом показана или её не дали начать).
    private var inBatch = false
    private var shown: UploadActivityAttributes.ContentState?
    /// Обновления по очереди: каждое ждёт предыдущее.
    private var chain: Task<Void, Never>?
    /// Оставшиеся от прошлого запуска (приложение выгрузили посреди пачки) уже убраны.
    private var staleEnded = false

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
        let current = done < total ? min(1, max(0, (progress?["current"] as? NSNumber)?.doubleValue ?? 0)) : 0
        if busy {
            guard total > 0 else { return }
            let state = UploadActivityAttributes.ContentState(done: done, total: total, current: current, finished: false, subtitle: texts.subtitle(total - done))
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
            let finished = data?["finished"] as? [String: Any]
            let finishedTotal = max(0, (finished?["total"] as? NSNumber)?.intValue ?? 0)
            let written = min(finishedTotal, max(0, (finished?["written"] as? NSNumber)?.intValue ?? 0))
            let state = UploadActivityAttributes.ContentState(
                done: written,
                total: finishedTotal,
                current: 0,
                finished: true,
                subtitle: written == finishedTotal ? texts.done(written) : texts.attention
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
        } catch {
            // Приложение не на виду (пачку начала фоновая задача) или Live Activity выключены.
            NSLog("[UploadLiveActivity] request: %@", error.localizedDescription)
        }
    }

    private func apply(_ state: UploadActivityAttributes.ContentState) {
        guard let activity, state != shown else { return }
        shown = state
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
