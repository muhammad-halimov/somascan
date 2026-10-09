/**
 * Движок очереди выгрузки: очередь записей, настройки хранилища и обработчик (`UploadWorker`),
 * собранные вне экрана приложения (см. `protocol.ts`).
 *
 * Очередь и настройки хранятся у хоста (файлы приложения), поэтому переживают закрытие приложения:
 * нативная часть поднимает движок без экрана (Android — фоновая работа WorkManager,
 * iOS — фоновые задачи), и он дописывает очередь. Экран присылает команды и получает снимки очереди.
 */
import type { StorageSettings } from '@/features/settings/store/settingsSchema'
import { parseRecords, UploadStore, type UploadRecord } from '@/features/uploads/store/UploadStore'
import { RetryPolicy } from '@/features/uploads/worker/RetryPolicy'
import type { TableBackendDeps } from '@/features/uploads/worker/tableBackends'
import { TableWriter, WRITE_STEPS } from '@/features/uploads/worker/TableWriter'
import { UploadWorker, type StorageSource } from '@/features/uploads/worker/UploadWorker'
import type { KeyValueStore } from '@/lib/storage/KeyValueStore'
import { StoredValue } from '@/lib/storage/StoredValue'
import { isRecord, isString } from '@/lib/validation/guards'
import { isBusy, type EngineActivity, type EngineCommand, type EngineEvent } from './protocol'

/** Настройки движка: куда писать и от чьего имени. */
interface EngineConfig {
  /** Раздел «Хранилище» настроек приложения. */
  storage: StorageSettings
  /** Id устройства — владелец блокировки таблицы. */
  deviceId: string
}

/** Пока приложение не прислало настройки: хранилище не настроено, записи ждут. */
const UNCONFIGURED: EngineConfig = {
  storage: {
    target: 'smb',
    smb: { host: '', share: '', filePath: '', domain: '', username: '', password: '' },
    googleDrive: { account: '', folder: '', fileName: '' },
    sheet: '',
  },
  deviceId: '',
}

/** Проверяет сохранённые настройки движка (форму `StorageSettings` проверяет приложение при отправке). */
function parseConfig(data: unknown): EngineConfig | null {
  if (!isRecord(data) || !isString(data.deviceId) || !isRecord(data.storage)) return null
  const storage = data.storage
  if (!isString(storage.target) || !isRecord(storage.smb) || !isRecord(storage.googleDrive)) return null
  return { storage: storage as unknown as StorageSettings, deviceId: data.deviceId }
}

/** Зависимости движка. */
export interface EngineDeps {
  /** Хранилище «ключ — значение» хоста (очередь и настройки). */
  storage: KeyValueStore
  /** Доступ к сетевому диску, токены Google, `fetch`. */
  backends: TableBackendDeps
  /** Отправка события нативной части. */
  emit: (event: EngineEvent) => void
  /** Паузы между попытками (подменяются в тестах). */
  retry?: RetryPolicy
}

/** Как часто обновляется плавный ход, пока пишется пачка (мс). */
const SMOOTH_TICK_MS = 300
/** Постоянная времени плавного хода: за неё он проходит ~63% пути до цели (мс). */
const SMOOTH_TAU_MS = 900
/** Какую часть пути до следующего шага записи плавный ход может пройти, пока шаг не пройден. */
const SMOOTH_CREEP = 0.9

/** Доля записи на следующем шаге после `current` (после последнего шага — конец записи). */
function nextStep(current: number) {
  return WRITE_STEPS.find((step) => step > current) ?? 1
}

/** Движок очереди. */
export class Engine {
  /** Очередь записей. */
  readonly store: UploadStore
  /** Сохранённые настройки. */
  private readonly stored: StoredValue<EngineConfig>
  /** Текущие настройки. */
  private config: EngineConfig
  /** Подписчики на изменения настроек (обработчик). */
  private readonly settingsListeners = new Set<() => void>()
  /** Обработчики среды, которые поставил `UploadWorker`. */
  private environment: { online: (online: boolean) => void; wake: () => void } | null = null
  /** Обработчик очереди. */
  private readonly worker: UploadWorker
  /** Отправка событий. */
  private readonly emit: (event: EngineEvent) => void
  /** Последняя отправленная активность (JSON) — одинаковые не повторяются. */
  private lastActivity = ''
  /** Ход текущей пачки записей (см. `EngineActivity.progress`). */
  private batch = { done: 0, total: 0 }
  /** Записи текущей пачки и записанные из них (записанную потом удалили — она всё равно учтена). */
  private readonly batchIds = new Set<string>()
  private readonly written = new Set<string>()
  /** Итог последней пачки (см. `EngineActivity.finished`). */
  private finished: EngineActivity['finished'] = null
  /** Плавный ход пачки в бирках (записанные + доля текущей) и когда он посчитан. */
  private smooth = { units: 0, at: 0 }
  /** Таймер обновления плавного хода. */
  private smoothTimer: ReturnType<typeof setTimeout> | null = null

  /** @param deps Зависимости. */
  constructor(deps: EngineDeps) {
    this.emit = deps.emit
    this.store = new UploadStore(deps.storage)
    this.stored = new StoredValue(deps.storage, 'somascan.engine.config.v1', parseConfig)
    this.config = this.stored.read() ?? UNCONFIGURED
    const settings: StorageSource = {
      getStorage: () => this.config.storage,
      subscribe: (listener) => {
        this.settingsListeners.add(listener)
        return () => this.settingsListeners.delete(listener)
      },
    }
    this.worker = new UploadWorker({
      store: this.store,
      settings,
      writer: new TableWriter(() => this.config.deviceId || 'device-unknown'),
      backends: deps.backends,
      retry: deps.retry ?? new RetryPolicy(),
      environment: {
        watch: (handlers) => {
          this.environment = handlers
          return () => {
            this.environment = null
          }
        },
      },
      onActivity: () => this.emitActivity(),
    })
  }

  /** Запускает обработку: оборванные записи — снова в очередь, дальше — по одной. */
  start() {
    this.emit({ type: 'ready' })
    this.store.subscribe(() => {
      this.emit({ type: 'state', records: this.store.getSnapshot() })
      this.emitActivity()
    })
    this.worker.start()
    this.emit({ type: 'state', records: this.store.getSnapshot() })
    this.emitActivity()
  }

  /** Выполняет команду нативной части. */
  command(command: EngineCommand) {
    switch (command.type) {
      case 'configure':
        this.configure({ storage: command.storage, deviceId: command.deviceId })
        break
      case 'enqueue': {
        const [record] = parseRecords([command.record]) ?? []
        if (record) this.store.add({ ...record, status: 'queued', attempts: 0 })
        this.worker.kick()
        break
      }
      case 'import':
        this.store.importRecords(Engine.importable(parseRecords(command.records) ?? []))
        this.worker.kick()
        break
      case 'retry':
        this.worker.retry(command.id)
        break
      case 'retryAll':
        this.worker.retryAll()
        break
      case 'cancel':
        this.worker.cancel(command.id)
        break
      case 'remove':
        this.store.remove(command.id)
        break
      case 'clearCompleted':
        this.store.clearCompleted()
        break
      case 'kick':
        this.environment?.wake()
        this.worker.kick()
        // Ответ всегда, даже без изменений: по нему фоновая задача узнаёт, что очередь пуста.
        this.emitActivity(true)
        break
      case 'network':
        this.environment?.online(command.online)
        break
    }
  }

  /**
   * Что сейчас делает очередь. Заодно ведёт ход пачки: пока очередь занята, обработанные записи
   * (записанные, отложенные после сбоя, ждущие пользователя) прибавляются к `done`, новые — к `total`;
   * в покое пачка сбрасывается, а её итог (сколько записано) остаётся в `finished`.
   */
  activity(now = Date.now()): EngineActivity {
    const records = this.store.getSnapshot()
    const queued = records.filter((record) => record.status === 'queued')
    const uploading = records.filter((record) => record.status === 'uploading').length
    const due = queued.filter((record) => (record.nextAttemptAt ?? 0) <= now).length
    const base = {
      running: this.worker.isRunning,
      online: this.worker.isOnline,
      due,
      waiting: queued.length - due,
      nextAttemptAt: this.store.nextAttemptAt(now),
      pending: queued.length + uploading,
      failed: records.filter((record) => record.status === 'failed').length,
    }
    for (const record of records) {
      if (record.status === 'completed' && this.batchIds.has(record.id)) this.written.add(record.id)
    }
    if (!isBusy({ ...base, progress: { ...this.batch, current: 0, fraction: 0 }, finished: this.finished })) {
      if (this.batch.total > 0) this.finished = { written: this.written.size, total: this.batch.total }
      this.batch = { done: 0, total: 0 }
      this.batchIds.clear()
      this.written.clear()
      this.smooth = { units: 0, at: 0 }
    } else {
      if (this.batch.total === 0) this.finished = null
      for (const record of records) {
        if (record.status === 'uploading' || (record.status === 'queued' && (record.nextAttemptAt ?? 0) <= now)) this.batchIds.add(record.id)
      }
      // Осталось в этой пачке: готовые к записи и та, что пишется сейчас.
      const remaining = due + uploading
      const done = this.batch.total === 0 ? 0 : Math.max(this.batch.done, this.batch.total - remaining)
      this.batch = { done, total: done + remaining }
    }
    const current = uploading > 0 && this.batch.total > 0 ? this.worker.currentProgress : 0
    const fraction = this.batch.total > 0 ? this.smoothFraction(current, now) : 0
    return { ...base, progress: { ...this.batch, current, fraction }, finished: this.finished && { ...this.finished } }
  }

  /**
   * Плавный ход пачки (0…1). Настоящий ход прыгает по шагам записи; плавный подтягивается к цели —
   * настоящему ходу плюс `SMOOTH_CREEP` пути до следующего шага — тем быстрее, чем она дальше,
   * поэтому полоса движется и пока шаг идёт, а следующего шага не обгоняет. Считается в бирках
   * (новые бирки в пачке уменьшают долю честно) и назад не идёт.
   */
  private smoothFraction(current: number, now: number) {
    const real = this.batch.done + current
    const target = real + SMOOTH_CREEP * (this.batch.done + nextStep(current) - real)
    const previous = this.smooth
    const units = previous.at === 0
      ? real
      : Math.max(previous.units, previous.units + (target - previous.units) * (1 - Math.exp(-(now - previous.at) / SMOOTH_TAU_MS)))
    this.smooth = { units: Math.min(units, this.batch.total), at: now }
    return Math.round((this.smooth.units / this.batch.total) * 1000) / 1000
  }

  /** Пока пачка пишется, плавный ход обновляется по таймеру (активность уходит, только если изменилась). */
  private scheduleSmoothTick(activity: EngineActivity) {
    if (this.smoothTimer !== null || !isBusy(activity) || activity.progress.total === 0) return
    this.smoothTimer = setTimeout(() => {
      this.smoothTimer = null
      this.emitActivity()
    }, SMOOTH_TICK_MS)
  }

  /** Новые настройки: сохраняются; если хранилище изменилось, обработчик повторит незаписанное. */
  private configure(next: EngineConfig) {
    if (JSON.stringify(next) === JSON.stringify(this.config)) return
    this.config = next
    this.stored.write(next)
    for (const listener of this.settingsListeners) listener()
  }

  /** Отправляет активность, если она изменилась (или `force`). */
  private emitActivity(force = false) {
    const activity = this.activity()
    this.scheduleSmoothTick(activity)
    const json = JSON.stringify(activity)
    if (json === this.lastActivity && !force) return
    this.lastActivity = json
    this.emit({ type: 'activity', activity })
  }

  /** Записи прежней очереди экрана: пишущиеся там (оборванные) — снова ждут. */
  private static importable(records: UploadRecord[]): UploadRecord[] {
    return records.map((record) => (record.status === 'uploading' ? { ...record, status: 'queued' as const } : record))
  }
}
