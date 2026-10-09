/**
 * Протокол между движком очереди выгрузки (`src/engine`) и нативной частью приложения.
 *
 * Движок — отдельный JS-файл `upload-engine.js`, который нативная часть держит вне WebView:
 * Android — в скрытом WebView процесса (живёт без экрана, пока идёт фоновая работа),
 * iOS — в JavaScriptCore. Поэтому очередь пишется и в свёрнутом, и в закрытом приложении,
 * а экран приложения только показывает очередь и шлёт команды (плагин `UploadEngine`).
 *
 * Нативная часть → движок: `SomascanEngine.command(json)` с одной из `EngineCommand`.
 * Движок → нативная часть: `SomascanHost.emit(тип, json)` с `EngineEvent`.
 */
import type { StorageSettings } from '@/features/settings/store/settingsSchema'
import type { UploadRecord } from '@/features/uploads/store/UploadStore'

/** Команда движку. */
export type EngineCommand =
  /** Настройки хранилища и id устройства (владелец блокировки таблицы); движок их сохраняет. */
  | { type: 'configure'; storage: StorageSettings; deviceId: string }
  /** Новая бирка в очередь (запись собрана экраном: номер, поля, колонки). */
  | { type: 'enqueue'; record: UploadRecord }
  /** Перенос записей из прежней очереди экрана (до движка); уже известные пропускаются. */
  | { type: 'import'; records: UploadRecord[] }
  /** Повторить одну запись без паузы. */
  | { type: 'retry'; id: string }
  /** Повторить все незаписанные без паузы. */
  | { type: 'retryAll' }
  /** Отменить незаписанную запись (пишущуюся — на ближайшем безопасном шаге). */
  | { type: 'cancel'; id: string }
  /** Удалить запись из истории (записанную). */
  | { type: 'remove'; id: string }
  /** Удалить все записанные. */
  | { type: 'clearCompleted' }
  /** Взяться за очередь (приложение проснулось, фоновая задача началась); в ответ — всегда `activity`. */
  | { type: 'kick' }
  /** Сеть появилась или пропала (по данным системы). */
  | { type: 'network'; online: boolean }

/** Что сейчас делает очередь — по этому нативная часть держит фоновую работу и пишет уведомление. */
export interface EngineActivity {
  /** Запись в таблицу идёт прямо сейчас. */
  running: boolean
  /** Сеть есть (последнее известное движку состояние). */
  online: boolean
  /** Записей, готовых к записи сейчас. */
  due: number
  /** Записей, ждущих паузы после временного сбоя. */
  waiting: number
  /** Ближайший повтор ждущих (мс с начала эпохи) или `null`. */
  nextAttemptAt: number | null
  /** Всего незаписанных в очереди (ждут или пишутся), без ждущих пользователя. */
  pending: number
  /** Не записанных из-за сбоя, который сам не пройдёт (ждут пользователя). */
  failed: number
  /**
   * Ход текущей выгрузки (для прогресса в уведомлении и в системе): сколько записей из пачки уже
   * обработано (`done`) из всех (`total`). Пачка — всё, что пишется без перерыва; новые бирки
   * добавляются к ней. В покое — `0 / 0`.
   */
  progress: { done: number; total: number }
  /**
   * Итог последней дописанной пачки: сколько записей из неё записано в таблицу (`written`) из всех
   * (`total`) — для итога в уведомлении. `null`, пока пачка идёт или пачек ещё не было.
   */
  finished: { written: number; total: number } | null
}

/** Событие движка. */
export type EngineEvent =
  /** Движок загружен и принимает команды. */
  | { type: 'ready' }
  /** Новый снимок очереди (для экрана «Загрузки»). */
  | { type: 'state'; records: UploadRecord[] }
  /** Изменилась активность очереди. */
  | { type: 'activity'; activity: EngineActivity }

/** Занята ли очередь: пишет или есть что писать при наличии сети. */
export const isBusy = (activity: EngineActivity) => activity.running || (activity.online && activity.due > 0)
