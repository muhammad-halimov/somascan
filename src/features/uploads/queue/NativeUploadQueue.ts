/**
 * Очередь на iOS и Android: записи пишет движок вне WebView (`src/engine`) через локальный плагин
 * `UploadEngine` (`android/.../UploadEnginePlugin.java`, `ios/App/App/UploadEnginePlugin.swift`).
 *
 * Экран присылает движку команды и настройки хранилища, а показывает снимки очереди, которые движок
 * присылает после каждого изменения (`uploadStore` здесь — зеркало, в `localStorage` не пишется).
 * Действия экрана сразу отражаются в зеркале, чтобы список не ждал ответа движка.
 *
 * Очередь прежних версий (в `localStorage` экрана) при первом запуске переносится в движок.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { LabelRecord } from '@/features/recognition/label/labelFields'
import { settingsStore } from '@/features/settings/store/SettingsStore'
import type { StorageSettings } from '@/features/settings/store/settingsSchema'
import { i18n } from '@/i18n/i18n'
import { appStorage, type KeyValueStore } from '@/lib/storage/KeyValueStore'
import { getDeviceId } from '@/lib/platform/deviceId'
import type { EngineCommand } from '@/engine/protocol'
import { parseRecords, UploadStore } from '../store/UploadStore'
import type { UploadColumn } from '../xlsx/uploadColumns'
import type { UploadQueue } from './UploadQueue'

/** Тексты фоновой выгрузки для системы (уведомление Android, фоновая задача iOS) на языке интерфейса. */
export interface BackgroundTexts {
  /** Заголовок: «Выгрузка в таблицу». */
  title: string
  /** Сколько осталось, с подстановкой `{count}`. */
  pending: string
  /** Ждёт сети или повтора. */
  waiting: string
}

/** Контракт нативного плагина. */
interface UploadEnginePlugin {
  /** Настройки хранилища, id устройства и тексты для системы. */
  configure(options: { storage: StorageSettings; deviceId: string; texts: BackgroundTexts }): Promise<void>
  /** Команда движку. */
  command(options: { command: EngineCommand }): Promise<void>
  /** Последний снимок очереди. */
  getState(): Promise<{ records?: unknown }>
  /** Разрешение на уведомление о фоновой выгрузке (Android 13+); на iOS не нужно. */
  requestNotifications(): Promise<{ granted: boolean }>
  /** Снимки очереди. */
  addListener(event: 'state', listener: (event: { records?: unknown }) => void): Promise<PluginListenerHandle>
}

/** Плагин движка (только в нативных сборках). */
const UploadEngine = registerPlugin<UploadEnginePlugin>('UploadEngine')

/** Ключ прежней очереди экрана (`UploadStore` в `localStorage`). */
const LEGACY_QUEUE_KEY = 'somascan.uploads.v2'

/** Спрашивали ли уже разрешение на уведомления. */
const NOTIFICATIONS_ASKED_KEY = 'somascan.uploads.notificationsAsked'

/** Очередь через движок. */
export class NativeUploadQueue implements UploadQueue {
  private readonly store: UploadStore
  private readonly storage: KeyValueStore
  /** Последние отправленные настройки (JSON) — одинаковые не повторяются. */
  private lastConfig = ''

  /**
   * @param store Зеркало очереди движка.
   * @param storage `localStorage` экрана (прежняя очередь, отметки).
   */
  constructor(store: UploadStore, storage: KeyValueStore = appStorage) {
    this.store = store
    this.storage = storage
  }

  start() {
    void UploadEngine.addListener('state', (event) => this.mirror(event.records))
    void UploadEngine.getState().then((state) => this.mirror(state.records)).catch(() => undefined)
    this.configure()
    settingsStore.subscribe(() => this.configure())
    i18n.on('languageChanged', () => this.configure())
    void this.migrate()
  }

  enqueue(label: LabelRecord, columns: readonly UploadColumn[]) {
    const record = UploadStore.createRecord(label, columns)
    this.store.add(record)
    this.send({ type: 'enqueue', record })
    this.askNotificationsOnce()
  }

  retry(id: string) {
    this.store.requeue(id)
    this.send({ type: 'retry', id })
  }

  retryAll() {
    this.store.retryAll()
    this.send({ type: 'retryAll' })
  }

  cancel(id: string) {
    const record = this.store.getSnapshot().find((candidate) => candidate.id === id)
    if (record && record.status !== 'uploading' && record.status !== 'completed') this.store.remove(id)
    else this.store.requestCancel(id)
    this.send({ type: 'cancel', id })
  }

  remove(id: string) {
    this.store.remove(id)
    this.send({ type: 'remove', id })
  }

  clearCompleted() {
    this.store.clearCompleted()
    this.send({ type: 'clearCompleted' })
  }

  /** Снимок очереди от движка → зеркало. */
  private mirror(records: unknown) {
    const parsed = parseRecords(records)
    if (parsed) this.store.replace(parsed)
  }

  /** Команда движку; сбой моста не роняет экран — записи остаются у движка. */
  private send(command: EngineCommand) {
    void UploadEngine.command({ command }).catch((error: unknown) => console.warn('[uploads] engine command', command.type, error))
  }

  /** Отправляет движку настройки хранилища, id устройства и тексты (если что-то изменилось). */
  private configure() {
    const options = {
      storage: settingsStore.getSnapshot().storage,
      deviceId: getDeviceId(this.storage),
      texts: {
        title: i18n.t('uploads:background.title'),
        pending: i18n.t('uploads:background.pending', { count: '{count}' }),
        waiting: i18n.t('uploads:background.waiting'),
      },
    }
    const json = JSON.stringify(options)
    if (json === this.lastConfig) return
    this.lastConfig = json
    void UploadEngine.configure(options).catch((error: unknown) => console.warn('[uploads] engine configure', error))
  }

  /** Переносит очередь прежней версии (из `localStorage` экрана) в движок и удаляет её у экрана. */
  private async migrate() {
    if (this.storage.get(LEGACY_QUEUE_KEY) === null && this.storage.get('somascan.uploads.v1') === null) return
    // Конструктор заодно переводит самый старый формат (v1) в нынешний.
    const records = new UploadStore(this.storage).getSnapshot()
    try {
      if (records.length > 0) await UploadEngine.command({ command: { type: 'import', records } })
      this.storage.remove(LEGACY_QUEUE_KEY)
    } catch (error) {
      console.warn('[uploads] migrate queue', error)
    }
  }

  /** Android 13+: один раз спрашивает разрешение на уведомление о фоновой выгрузке. */
  private askNotificationsOnce() {
    if (this.storage.get(NOTIFICATIONS_ASKED_KEY)) return
    this.storage.set(NOTIFICATIONS_ASKED_KEY, '1')
    void UploadEngine.requestNotifications().catch(() => undefined)
  }
}
