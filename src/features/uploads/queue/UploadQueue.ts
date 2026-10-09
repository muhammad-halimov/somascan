/**
 * Очередь выгрузки с точки зрения экрана: показать записи (`uploadStore`) и отдать команды.
 *
 * - iOS и Android — `NativeUploadQueue`: записи пишет движок вне WebView (плагин `UploadEngine`),
 *   поэтому очередь дописывается в свёрнутом и закрытом приложении; `uploadStore` — его зеркало.
 * - Браузер — `LocalUploadQueue`: очередь обрабатывается прямо на странице, как раньше
 *   (сетевого диска в браузере нет — записи получают `unavailable`).
 */
import type { LabelRecord } from '@/features/recognition/label/labelFields'
import type { UploadColumn } from '../xlsx/uploadColumns'

/** Команды очереди от экрана. */
export interface UploadQueue {
  /** Подключает очередь: зеркало, настройки, перенос прежней очереди. */
  start(): void
  /** Ставит бирку в очередь (кнопка «Далее»). */
  enqueue(label: LabelRecord, columns: readonly UploadColumn[]): void
  /** Повторяет одну запись без паузы. */
  retry(id: string): void
  /** Повторяет все незаписанные без паузы. */
  retryAll(): void
  /** Отменяет незаписанную запись (пишущуюся — на ближайшем безопасном шаге). */
  cancel(id: string): void
  /** Удаляет записанную бирку из истории. */
  remove(id: string): void
  /** Удаляет все записанные. */
  clearCompleted(): void
}
