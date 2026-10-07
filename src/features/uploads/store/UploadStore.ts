/**
 * Очередь выгрузки в таблицу и история записей («Загрузки»).
 *
 * Запись появляется по нажатию «Далее» со статусом `queued` и хранится на устройстве, поэтому
 * очередь переживает перезапуск приложения. `UploadWorker` берёт записи по одной (самую старую
 * из готовых), переводит в `uploading`, а затем в `completed` или обратно в `queued` с паузой
 * (временный сбой) либо в `failed` (нужно вмешательство: пароль, настройки). Новые записи сверху.
 */
import { appStorage, type KeyValueStore } from '@/lib/storage/KeyValueStore'
import { StoredValue } from '@/lib/storage/StoredValue'
import { Store } from '@/lib/store/Store'
import { isOneOf, isRecord, isString } from '@/lib/validation/guards'
import type { LabelRecord, LabelValue } from '@/features/recognition/label/labelFields'
import { isUploadErrorCode, type UploadError, type UploadErrorCode } from '../UploadError'
import type { UploadColumn, UploadColumnKind } from '../xlsx/uploadColumns'

/** Состояние записи в очереди. */
export type UploadStatus =
  /** Ждёт своей очереди (возможно, с паузой после временного сбоя — см. `nextAttemptAt`). */
  | 'queued'
  /** Записывается в таблицу прямо сейчас. */
  | 'uploading'
  /** Записана и проверена. */
  | 'completed'
  /** Не записана: нужно исправить настройки или повторить вручную. */
  | 'failed'

/** Все статусы. */
export const UPLOAD_STATUSES: readonly UploadStatus[] = ['queued', 'uploading', 'completed', 'failed']

/** Последний сбой записи. */
export interface UploadFailure {
  /** Код ошибки (сообщение — в `errors:upload.<код>`). */
  code: UploadErrorCode
  /** Подробности от нативной части, если есть. */
  detail?: string
  /** Когда случился сбой (мс с начала эпохи). */
  at: number
}

/** Одна бирка в очереди или истории. */
export interface UploadRecord {
  /** Уникальный id. */
  id: string
  /** Когда нажали «Далее» (мс с начала эпохи). В таблицу пишется не он, а момент самой записи («Дата записи»). */
  createdAt: number
  /** Собственный номер записи (`SCN-ГГММДД-XXXX`): пишется в таблицу и защищает от повторной записи той же бирки. */
  localNumber: string
  /** Поля бирки (после правок пользователя). */
  label: LabelRecord
  /** Колонки таблицы в момент постановки в очередь (служебные + включённые поля). */
  columns: UploadColumn[]
  /** Состояние. */
  status: UploadStatus
  /** Сколько попыток записи уже было. */
  attempts: number
  /** Раньше этого момента запись не повторяется (пауза после временного сбоя). */
  nextAttemptAt?: number
  /** Последний сбой. */
  error?: UploadFailure
  /** Когда запись попала в таблицу. */
  completedAt?: number
  /** Номер строки в таблице. */
  rowNumber?: number
}

/** Двузначное число с ведущим нулём. */
const pad2 = (value: number) => String(value).padStart(2, '0')

/**
 * Собственный номер записи: префикс, дата и четыре символа из `id`, например `SCN-261006-7F3A`.
 * Детерминирован, поэтому одинаков при каждом показе.
 */
export function createLocalNumber(id: string, createdAt: number) {
  const date = new Date(createdAt)
  const day = `${pad2(date.getFullYear() % 100)}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`
  const tail = id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase().padStart(4, '0')
  return `SCN-${day}-${tail}`
}

/** Уникальный id записи. `randomUUID` есть только в защищённых контекстах (нет на dev-сервере по IP). */
const createId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

/** Допустимые виды колонок. */
const COLUMN_KINDS: readonly UploadColumnKind[] = ['code', 'text', 'number', 'weight', 'date', 'time', 'record_number', 'recorded_at']

/** Проверяет сохранённую колонку. */
const isUploadColumn = (value: unknown): value is UploadColumn =>
  isRecord(value)
  && isString(value.key)
  && isString(value.header)
  && Array.isArray(value.aliases) && value.aliases.every(isString)
  && isOneOf(COLUMN_KINDS)(value.kind)

/** Значение поля бирки. */
const isLabelValue = (value: unknown): value is LabelValue => value === null || isString(value) || typeof value === 'number'

/** Проверяет сохранённые поля бирки, отбрасывая чужие значения. */
function readLabel(value: unknown): LabelRecord | null {
  if (!isRecord(value)) return null
  return Object.fromEntries(Object.entries(value).filter(([, item]) => isLabelValue(item))) as LabelRecord
}

/** Проверяет сохранённый сбой. */
function readFailure(value: unknown): UploadFailure | undefined {
  if (!isRecord(value) || !isUploadErrorCode(value.code) || typeof value.at !== 'number') return undefined
  return { code: value.code, at: value.at, ...(isString(value.detail) ? { detail: value.detail } : {}) }
}

/** Необязательное число. */
const optionalNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** Проверяет сохранённую запись; неполные записи отбрасываются. */
function readRecord(value: unknown): UploadRecord | null {
  if (!isRecord(value) || !isString(value.id) || typeof value.createdAt !== 'number' || !isOneOf(UPLOAD_STATUSES)(value.status)) return null
  const label = readLabel(value.label)
  if (!label || !Array.isArray(value.columns) || !value.columns.every(isUploadColumn)) return null
  const record: UploadRecord = {
    id: value.id,
    createdAt: value.createdAt,
    localNumber: isString(value.localNumber) ? value.localNumber : createLocalNumber(value.id, value.createdAt),
    label,
    columns: value.columns,
    status: value.status,
    attempts: optionalNumber(value.attempts) ?? 0,
  }
  const nextAttemptAt = optionalNumber(value.nextAttemptAt)
  if (nextAttemptAt !== undefined) record.nextAttemptAt = nextAttemptAt
  const error = readFailure(value.error)
  if (error) record.error = error
  const completedAt = optionalNumber(value.completedAt)
  if (completedAt !== undefined) record.completedAt = completedAt
  const rowNumber = optionalNumber(value.rowNumber)
  if (rowNumber !== undefined) record.rowNumber = rowNumber
  return record
}

/** Разбирает сохранённый список. */
const parseRecords = (data: unknown): UploadRecord[] | null =>
  Array.isArray(data) ? data.map(readRecord).filter((record): record is UploadRecord => record !== null) : null

/** Ключ списка в прежней версии: записи хранили лишь несколько полей бирки и не знали об очереди. */
const V1_KEY = 'somascan.uploads.v1'

/** Переносит записи прежней версии: они считаются завершёнными, поля — те немногие, что сохранялись. */
function readV1Records(storage: KeyValueStore): UploadRecord[] | null {
  const raw = storage.get(V1_KEY)
  if (raw === null) return null
  try {
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return null
    return data.filter(isRecord).flatMap((item) => {
      if (!isString(item.id) || typeof item.createdAt !== 'number') return []
      const fields: Array<[string, unknown]> = [
        ['contract', item.contract], ['destination', item.destination], ['weight_kg', item.weight],
        ['grade', item.grade], ['size', item.size], ['heat', item.heat], ['batch', item.batch],
      ]
      const label = Object.fromEntries(fields.filter((entry): entry is [string, string] => isString(entry[1])))
      return [{
        id: item.id,
        createdAt: item.createdAt,
        localNumber: isString(item.localNumber) ? item.localNumber : createLocalNumber(item.id, item.createdAt),
        label,
        columns: [],
        status: 'completed' as const,
        attempts: 0,
        completedAt: item.createdAt,
      }]
    })
  } catch {
    return null
  }
}

/** Сколько записей ждут или пишутся. */
export const pendingCount = (records: readonly UploadRecord[]) =>
  records.filter((record) => record.status === 'queued' || record.status === 'uploading').length

/** Есть ли записи, которые не удалось записать. */
export const hasFailed = (records: readonly UploadRecord[]) => records.some((record) => record.status === 'failed')

/** Очередь выгрузки и история записей, сохраняемые на устройстве. */
export class UploadStore extends Store<UploadRecord[]> {
  /** Сколько записей хранится; сверх этого удаляются самые старые завершённые. Очередь не обрезается. */
  static readonly LIMIT = 200

  /** Сохранённая копия списка. */
  private readonly stored: StoredValue<UploadRecord[]>

  /** @param storage Хранилище «ключ — значение». */
  constructor(storage: KeyValueStore) {
    const stored = new StoredValue(storage, 'somascan.uploads.v2', parseRecords)
    const legacy = stored.read() ? null : readV1Records(storage)
    super(stored.read() ?? legacy ?? [])
    this.stored = stored
    if (legacy) stored.write(legacy)
    storage.remove(V1_KEY)
  }

  /** Сохраняет каждый новый снимок. */
  protected override onChange(records: UploadRecord[]) {
    this.stored.write(records)
  }

  /** Ставит бирку в очередь (в начало списка) и возвращает запись. */
  enqueue(label: LabelRecord, columns: readonly UploadColumn[]): UploadRecord {
    const createdAt = Date.now()
    const id = createId()
    const record: UploadRecord = {
      id,
      createdAt,
      localNumber: createLocalNumber(id, createdAt),
      label: { ...label },
      columns: columns.map((column) => ({ ...column, aliases: [...column.aliases] })),
      status: 'queued',
      attempts: 0,
    }
    this.setState((records) => UploadStore.trim([record, ...records]))
    return record
  }

  /** Самая старая запись, готовая к записи: `queued` без паузы или с истёкшей паузой. */
  nextDue(now: number): UploadRecord | null {
    const records = this.getSnapshot()
    for (let index = records.length - 1; index >= 0; index--) {
      const record = records[index]!
      if (record.status === 'queued' && (record.nextAttemptAt ?? 0) <= now) return record
    }
    return null
  }

  /** Ближайший момент, когда появится готовая запись, или `null`, если ждать нечего. */
  nextAttemptAt(now: number): number | null {
    const waiting = this.getSnapshot().filter((record) => record.status === 'queued' && (record.nextAttemptAt ?? 0) > now)
    return waiting.length === 0 ? null : Math.min(...waiting.map((record) => record.nextAttemptAt!))
  }

  /** Запись начала записываться. */
  markUploading(id: string) {
    this.patch(id, (record) => ({ ...record, status: 'uploading', nextAttemptAt: undefined }))
  }

  /** Запись попала в таблицу и проверена. */
  markCompleted(id: string, rowNumber: number) {
    this.patch(id, (record) => ({ ...record, status: 'completed', completedAt: Date.now(), rowNumber, error: undefined, nextAttemptAt: undefined }))
  }

  /** Временный сбой: запись вернётся в очередь и повторится не раньше `nextAttemptAt`. */
  markRetry(id: string, error: UploadError, attempts: number, nextAttemptAt: number) {
    this.patch(id, (record) => ({ ...record, status: 'queued', attempts, nextAttemptAt, error: UploadStore.failureOf(error) }))
  }

  /** Сбой, который не пройдёт сам: запись ждёт действий пользователя. */
  markFailed(id: string, error: UploadError, attempts: number) {
    this.patch(id, (record) => ({ ...record, status: 'failed', attempts, nextAttemptAt: undefined, error: UploadStore.failureOf(error) }))
  }

  /** Возвращает одну запись в очередь без паузы (кнопка «Повторить»). */
  requeue(id: string) {
    this.patch(id, (record) => (record.status === 'completed' ? record : { ...record, status: 'queued', attempts: 0, nextAttemptAt: undefined }))
  }

  /** Возвращает в очередь все незаписанные и снимает паузы (после смены настроек хранилища). */
  retryAll() {
    this.setState((records) => records.map((record) => (
      record.status === 'failed' || (record.status === 'queued' && record.nextAttemptAt !== undefined)
        ? { ...record, status: 'queued' as const, attempts: 0, nextAttemptAt: undefined }
        : record
    )))
  }

  /** Снимает паузы у ждущих записей (сеть вернулась): они пойдут сразу. */
  resetBackoff() {
    this.setState((records) => records.map((record) => (
      record.status === 'queued' && record.nextAttemptAt !== undefined ? { ...record, nextAttemptAt: undefined } : record
    )))
  }

  /** После перезапуска: записи, оборванные на середине, возвращаются в очередь. */
  resetInterrupted() {
    this.setState((records) => records.map((record) => (record.status === 'uploading' ? { ...record, status: 'queued' as const } : record)))
  }

  /** Удаляет одну запись. Пишущуюся сейчас удалить нельзя — она допишется и будет отмечена завершённой. */
  remove(id: string) {
    this.setState((records) => records.filter((record) => record.id !== id || record.status === 'uploading'))
  }

  /** Удаляет все завершённые записи. */
  clearCompleted() {
    this.setState((records) => records.filter((record) => record.status !== 'completed'))
  }

  /** Меняет запись по `id`; если записи нет (удалили), ничего не делает. */
  private patch(id: string, recipe: (record: UploadRecord) => UploadRecord) {
    this.setState((records) => {
      const index = records.findIndex((record) => record.id === id)
      if (index < 0) return records
      const next = [...records]
      next[index] = recipe(records[index]!)
      return next
    })
  }

  /** Сбой для сохранения в записи. */
  private static failureOf(error: UploadError): UploadFailure {
    return { code: error.code, at: Date.now(), ...(error.params.detail ? { detail: error.params.detail } : {}) }
  }

  /** Держит список в пределах `LIMIT`, удаляя самые старые завершённые записи. */
  private static trim(records: UploadRecord[]): UploadRecord[] {
    if (records.length <= UploadStore.LIMIT) return records
    const result = [...records]
    for (let index = result.length - 1; index >= 0 && result.length > UploadStore.LIMIT; index--) {
      if (result[index]!.status === 'completed') result.splice(index, 1)
    }
    return result
  }
}

/** Общая очередь выгрузки приложения. */
export const uploadStore = new UploadStore(appStorage)
