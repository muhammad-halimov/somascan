import ActivityKit
import Foundation

/**
 * Live Activity выгрузки в таблицу: что приложение передаёт виджету (экран блокировки и Dynamic
 * Island). Файл входит в обе цели — приложение (`UploadLiveActivity`) и расширение `UploadActivity`.
 *
 * Тексты приходят готовыми, на языке приложения: у расширения нет доступа к настройкам приложения.
 */
struct UploadActivityAttributes: ActivityAttributes {

    struct ContentState: Codable, Hashable {
        /// Ход пачки: обработано из всех. В итоге — записано из всех.
        var done: Int
        var total: Int
        /// Пройдено в бирке, которая пишется сейчас (0…1, по шагам записи).
        var current: Double
        /// Пачка дописана: показывается итог.
        var finished: Bool
        /// Строка под заголовком: «Осталось записать: 2», «Записано в таблицу: 3», «Не всё записано…».
        var subtitle: String

        /// Итог без сбоев: записано всё.
        var isComplete: Bool { finished && done == total }

        /// Доля для полосы прогресса (0…1): движется и внутри записи одной бирки.
        var fraction: Double { total > 0 ? min(1, (Double(done) + current) / Double(total)) : 0 }
    }

    /// Заголовок: «Выгрузка в таблицу».
    var title: String
}
