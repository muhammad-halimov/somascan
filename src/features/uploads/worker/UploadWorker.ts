/**
 * Фоновая обработка очереди выгрузки.
 *
 * Берёт из `UploadStore` самую старую готовую запись и пишет её через `TableWriter` в хранилище
 * из настроек (сетевой диск или Google Drive);
 * записи обрабатываются строго по одной, чтобы два экземпляра не правили таблицу одновременно.
 * Временные сбои повторяются с растущей паузой (`RetryPolicy`), постоянные ждут пользователя.
 *
 * Пробуждается: при появлении записи, по таймеру паузы, при возврате сети, при возвращении
 * приложения на передний план и через полторы секунды после изменения настроек хранилища
 * (тогда все незаписанные записи возвращаются в очередь без паузы).
 *
 * В браузере нативного плагина нет: записи получают постоянный сбой `unavailable`.
 */
import { App } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { Network } from '@capacitor/network'
import { settingsStore, type SettingsStore } from '@/features/settings/store/SettingsStore'
import type { StorageSettings } from '@/features/settings/store/settingsSchema'
import { getDeviceId } from '@/lib/platform/deviceId'
import { googleDriveSession } from '../drive/GoogleDriveAuth'
import { uploadStore, type UploadRecord, type UploadStore } from '../store/UploadStore'
import { isTransientUploadError, toUploadError } from '../UploadError'
import { RetryPolicy } from './RetryPolicy'
import { backendFor, defaultBackendDeps, type TableBackendDeps } from './tableBackends'
import { TableWriter } from './TableWriter'

/** Пауза после последнего изменения настроек хранилища: пока пользователь печатает, не подключаемся. */
const SETTINGS_DEBOUNCE_MS = 1500

/** Зависимости `UploadWorker`. */
export interface UploadWorkerDeps {
  /** Очередь записей. */
  store: UploadStore
  /** Настройки (нужен раздел «Хранилище»). */
  settings: SettingsStore
  /** Запись в таблицу. */
  writer: TableWriter
  /** Доступ к хранилищам. */
  backends: TableBackendDeps
  /** Паузы между попытками. */
  retry: RetryPolicy
}

/** Обработчик очереди: одна запись за раз. */
export class UploadWorker {
  /** Очередь записей. */
  private readonly store: UploadStore
  /** Настройки. */
  private readonly settings: SettingsStore
  /** Запись в таблицу. */
  private readonly writer: TableWriter
  /** Доступ к хранилищам. */
  private readonly backends: TableBackendDeps
  /** Паузы между попытками. */
  private readonly retryPolicy: RetryPolicy
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
  /** Последний виденный раздел настроек хранилища — чтобы реагировать только на его изменения. */
  private lastStorage: StorageSettings | null = null
  /** Отписки для `stop()`. */
  private readonly cleanups: Array<() => void> = []

  /** @param deps Зависимости. */
  constructor(deps: UploadWorkerDeps) {
    this.store = deps.store
    this.settings = deps.settings
    this.writer = deps.writer
    this.backends = deps.backends
    this.retryPolicy = deps.retry
  }

  /** Запускает обработку: возвращает оборванные записи в очередь, подписывается на события и берётся за очередь. */
  start() {
    if (this.started) return
    this.started = true
    this.store.resetInterrupted()
    this.lastStorage = this.settings.getSnapshot().storage
    this.cleanups.push(this.store.subscribe(() => this.tick()))
    this.cleanups.push(this.settings.subscribe(() => this.onSettingsChange()))
    this.watchNetwork()
    this.watchAppState()
    this.tick()
  }

  /** Останавливает обработку (текущая запись завершится). */
  stop() {
    if (!this.started) return
    this.started = false
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    if (this.timer !== null) window.clearTimeout(this.timer)
    if (this.settingsTimer !== null) window.clearTimeout(this.settingsTimer)
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

  /** Повторяет все незаписанные записи без паузы. */
  retryAll() {
    this.store.retryAll()
    this.tick()
  }

  /** Проверяет подключение к хранилищу с текущими настройками (кнопка во вкладке «Хранилище»). */
  async testConnection() {
    return (await backendFor(this.settings.getSnapshot().storage, this.backends)).probe()
  }

  /** Настройки хранилища изменились: немного ждём и повторяем всё незаписанное. */
  private onSettingsChange() {
    const { storage } = this.settings.getSnapshot()
    if (storage === this.lastStorage) return
    this.lastStorage = storage
    if (this.settingsTimer !== null) window.clearTimeout(this.settingsTimer)
    this.settingsTimer = window.setTimeout(() => {
      this.settingsTimer = null
      this.retryAll()
    }, SETTINGS_DEBOUNCE_MS)
  }

  /** Следит за сетью: без неё очередь ждёт, с возвращением сети паузы снимаются. */
  private watchNetwork() {
    let active = true
    let handle: PluginListenerHandle | undefined
    void Network.getStatus()
      .then((status) => { if (active) this.setOnline(status.connected) })
      .catch(() => undefined)
    void Network.addListener('networkStatusChange', (status) => this.setOnline(status.connected))
      .then((listener) => {
        handle = listener
        if (!active) void listener.remove()
      })
      .catch(() => undefined)
    const onOnline = () => this.setOnline(true)
    const onOffline = () => this.setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    this.cleanups.push(() => {
      active = false
      void handle?.remove()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    })
  }

  /** Приложение вернулось на передний план — проверяем очередь. */
  private watchAppState() {
    let active = true
    let handle: PluginListenerHandle | undefined
    void App.addListener('appStateChange', ({ isActive }) => { if (isActive) this.tick() })
      .then((listener) => {
        handle = listener
        if (!active) void listener.remove()
      })
      .catch(() => undefined)
    this.cleanups.push(() => {
      active = false
      void handle?.remove()
    })
  }

  /** Запоминает состояние сети; при её возвращении снимает паузы и берётся за очередь. */
  private setOnline(online: boolean) {
    const wasOnline = this.online
    this.online = online
    if (online && !wasOnline) this.store.resetBackoff()
    if (online) this.tick()
  }

  /** Берёт следующую готовую запись или ставит таймер до ближайшей паузы. */
  private readonly tick = () => {
    if (!this.started || this.running) return
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
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
      this.timer = window.setTimeout(() => {
        this.timer = null
        this.tick()
      }, Math.max(250, next - now))
    }
  }

  /** Пишет одну запись и переводит её в итоговый статус. */
  private async run(job: UploadRecord) {
    this.running = true
    this.store.markUploading(job.id)
    try {
      const backend = await backendFor(this.settings.getSnapshot().storage, this.backends)
      const result = await this.writer.write(job, backend)
      this.store.markCompleted(job.id, result.rowNumber)
    } catch (error) {
      const failure = toUploadError(error)
      const attempts = job.attempts + 1
      if (isTransientUploadError(failure.code)) {
        this.store.markRetry(job.id, failure, attempts, Date.now() + this.retryPolicy.delayFor(attempts))
      } else {
        this.store.markFailed(job.id, failure, attempts)
      }
      console.warn('[uploads]', job.localNumber, failure.code, failure.params.detail ?? '')
    } finally {
      this.running = false
      this.tick()
    }
  }
}

/** Общий обработчик очереди приложения. */
export const uploadWorker = new UploadWorker({
  store: uploadStore,
  settings: settingsStore,
  writer: new TableWriter(getDeviceId()),
  backends: defaultBackendDeps(googleDriveSession),
  retry: new RetryPolicy(),
})
