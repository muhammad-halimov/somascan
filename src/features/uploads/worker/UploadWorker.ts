/**
 * Фоновая обработка очереди выгрузки.
 *
 * Берёт из `UploadStore` самую старую готовую запись и пишет её через `TableWriter` в хранилище
 * из настроек (сетевой диск или Google Drive);
 * записи обрабатываются строго по одной, чтобы два экземпляра не правили таблицу одновременно.
 * Временные сбои повторяются с растущей паузой (`RetryPolicy`), постоянные ждут пользователя.
 *
 * Пробуждается: при появлении записи, по таймеру паузы, при возврате сети, при пробуждении от среды
 * (приложение вернулось на передний план, началась фоновая задача) и через полторы секунды после
 * изменения настроек хранилища (тогда все незаписанные записи возвращаются в очередь без паузы).
 *
 * Класс не знает, где работает: настройки, сеть и пробуждения приходят через зависимости.
 * На iOS и Android он работает в движке очереди вне WebView (`src/engine`), в браузере —
 * прямо на странице (`uploads/queue/LocalUploadQueue.ts`).
 *
 * Незаписанную запись можно отменить (`cancel`): ждущая просто убирается из очереди, пишущаяся
 * останавливается на ближайшем безопасном шаге — до замены файла в хранилище. Если файл уже
 * заменяется, отменять нечего: запись допишется и будет отмечена завершённой.
 *
 * В браузере нативного плагина нет: записи получают постоянный сбой `unavailable`.
 */
import type { StorageSettings } from '@/features/settings/store/settingsSchema'
import type { UploadRecord, UploadStore } from '../store/UploadStore'
import { isTransientUploadError, toUploadError } from '../UploadError'
import type { RetryPolicy } from './RetryPolicy'
import { backendFor, type TableBackendDeps } from './tableBackends'
import type { TableWriter } from './TableWriter'

/** Пауза после последнего изменения настроек хранилища: пока пользователь печатает, не подключаемся. */
const SETTINGS_DEBOUNCE_MS = 1500

/** Откуда брать настройки хранилища. */
export interface StorageSource {
  /** Текущие настройки хранилища. */
  getStorage(): StorageSettings
  /** Подписка на их изменения; возвращает отписку. */
  subscribe(listener: () => void): () => void
}

/** Сеть и пробуждения от среды, где работает обработчик. */
export interface UploadEnvironment {
  /**
   * Подписка: `online` — сеть появилась или пропала (сначала — текущее состояние, если оно известно),
   * `wake` — стоит проверить очередь (приложение вернулось на передний план, началась фоновая задача).
   * Возвращает отписку.
   */
  watch(handlers: { online: (online: boolean) => void; wake: () => void }): () => void
}

/** Зависимости `UploadWorker`. */
export interface UploadWorkerDeps {
  /** Очередь записей. */
  store: UploadStore
  /** Настройки хранилища. */
  settings: StorageSource
  /** Запись в таблицу. */
  writer: TableWriter
  /** Доступ к хранилищам. */
  backends: TableBackendDeps
  /** Паузы между попытками. */
  retry: RetryPolicy
  /** Сеть и пробуждения. */
  environment: UploadEnvironment
  /** Вызывается, когда запись начинается или заканчивается и когда меняется состояние сети. */
  onActivity?: () => void
}

/** Обработчик очереди: одна запись за раз. */
export class UploadWorker {
  /** Очередь записей. */
  private readonly store: UploadStore
  /** Настройки хранилища. */
  private readonly settings: StorageSource
  /** Запись в таблицу. */
  private readonly writer: TableWriter
  /** Доступ к хранилищам. */
  private readonly backends: TableBackendDeps
  /** Паузы между попытками. */
  private readonly retryPolicy: RetryPolicy
  /** Сеть и пробуждения. */
  private readonly environment: UploadEnvironment
  /** Сообщение об изменении активности. */
  private readonly onActivity: () => void
  /** `start()` уже вызывался. */
  private started = false
  /** Запись идёт прямо сейчас. */
  private running = false
  /** Есть сеть (по данным плагина Network). */
  private online = true
  /** Таймер до ближайшей паузы. */
  private timer: number | null = null
  /** Таймер ожидания после изменения настроек. */
  private settingsTimer: number | null = null
  /** Последние виденные настройки хранилища (JSON) — чтобы реагировать только на их изменения. */
  private lastStorage = ''
  /** Отмена текущей записи (пока она пишется). */
  private current: { id: string; controller: AbortController } | null = null
  /** Отписки для `stop()`. */
  private readonly cleanups: Array<() => void> = []

  /** @param deps Зависимости. */
  constructor(deps: UploadWorkerDeps) {
    this.store = deps.store
    this.settings = deps.settings
    this.writer = deps.writer
    this.backends = deps.backends
    this.retryPolicy = deps.retry
    this.environment = deps.environment
    this.onActivity = deps.onActivity ?? (() => undefined)
  }

  /** Запись в таблицу идёт прямо сейчас. */
  get isRunning() {
    return this.running
  }

  /** Есть ли сеть (последнее известное состояние). */
  get isOnline() {
    return this.online
  }

  /** Запускает обработку: возвращает оборванные записи в очередь, подписывается на события и берётся за очередь. */
  start() {
    if (this.started) return
    this.started = true
    this.store.resetInterrupted()
    this.lastStorage = JSON.stringify(this.settings.getStorage())
    this.cleanups.push(this.store.subscribe(() => this.tick()))
    this.cleanups.push(this.settings.subscribe(() => this.onSettingsChange()))
    this.cleanups.push(this.environment.watch({ online: (online) => this.setOnline(online), wake: () => this.tick() }))
    this.tick()
  }

  /** Останавливает обработку (текущая запись завершится). */
  stop() {
    if (!this.started) return
    this.started = false
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    if (this.timer !== null) clearTimeout(this.timer)
    if (this.settingsTimer !== null) clearTimeout(this.settingsTimer)
    this.timer = null
    this.settingsTimer = null
  }

  /** Просьба взяться за очередь (например, после постановки записи). */
  kick() {
    this.tick()
  }

  /** Повторяет одну запись без паузы. */
  retry(id: string) {
    this.store.requeue(id)
    this.tick()
  }

  /**
   * Отменяет незаписанную запись: ждущую или сбойную убирает сразу, пишущуюся — когда запись
   * остановится (см. описание класса).
   */
  cancel(id: string) {
    const record = this.store.getSnapshot().find((candidate) => candidate.id === id)
    if (!record || record.status === 'completed') return
    if (record.status !== 'uploading') {
      this.store.remove(id)
      return
    }
    this.store.requestCancel(id)
    if (this.current?.id === id) this.current.controller.abort()
  }

  /** Повторяет все незаписанные записи без паузы. */
  retryAll() {
    this.store.retryAll()
    this.tick()
  }

  /** Настройки хранилища изменились: немного ждём и повторяем всё незаписанное. */
  private onSettingsChange() {
    const storage = JSON.stringify(this.settings.getStorage())
    if (storage === this.lastStorage) return
    this.lastStorage = storage
    if (this.settingsTimer !== null) clearTimeout(this.settingsTimer)
    this.settingsTimer = setTimeout(() => {
      this.settingsTimer = null
      this.retryAll()
    }, SETTINGS_DEBOUNCE_MS)
  }

  /** Запоминает состояние сети; при её возвращении снимает паузы и берётся за очередь. */
  private setOnline(online: boolean) {
    const wasOnline = this.online
    this.online = online
    if (online !== wasOnline) this.onActivity()
    if (online && !wasOnline) this.store.resetBackoff()
    if (online) this.tick()
  }

  /** Берёт следующую готовую запись или ставит таймер до ближайшей паузы. */
  private readonly tick = () => {
    if (!this.started || this.running) return
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.online) return
    const now = Date.now()
    const job = this.store.nextDue(now)
    if (job) {
      void this.run(job)
      return
    }
    const next = this.store.nextAttemptAt(now)
    if (next !== null) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.tick()
      }, Math.max(250, next - now))
    }
  }

  /** Пишет одну запись и переводит её в итоговый статус. */
  private async run(job: UploadRecord) {
    this.running = true
    this.onActivity()
    const controller = new AbortController()
    this.current = { id: job.id, controller }
    this.store.markUploading(job.id)
    try {
      const backend = await backendFor(this.settings.getStorage(), this.backends)
      const result = await this.writer.write(job, backend, controller.signal)
      // Отмена пришла, когда файл уже заменялся: бирка в журнале — запись завершена.
      this.store.markCompleted(job.id, result.rowNumber, result.sheet, result.item ?? undefined)
    } catch (error) {
      // Отменили — запись остановлена до замены файла, журнал не тронут: убираем её из очереди.
      if (controller.signal.aborted) {
        this.store.discard(job.id)
        return
      }
      const failure = toUploadError(error)
      const attempts = job.attempts + 1
      if (isTransientUploadError(failure.code)) {
        this.store.markRetry(job.id, failure, attempts, Date.now() + this.retryPolicy.delayFor(attempts))
      } else {
        this.store.markFailed(job.id, failure, attempts)
      }
      console.warn('[uploads]', job.localNumber, failure.code, failure.params.detail ?? '')
    } finally {
      this.current = null
      this.running = false
      this.tick()
      this.onActivity()
    }
  }
}
