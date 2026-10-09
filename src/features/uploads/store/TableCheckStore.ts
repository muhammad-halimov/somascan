/**
 * Проверка наличия таблицы («Настройки → Хранилище»: значок сверки в конце поля пути к таблице
 * и «Проверить подключение»).
 *
 * Приложение таблиц не создаёт: если журнала по пути из настроек нет, писать некуда — запись в очереди
 * получает `tableNotFound` и ждёт исправления настроек. Проверка показывает это заранее.
 *
 * Итог хранится вместе с настройками хранилища, для которых он получен: любая правка (сервер, папка,
 * путь, аккаунт) — и прежний итог больше не относится к ним (`resultFor` вернёт `null`); выбор листа
 * итог не сбрасывает (`sameTable`). Итог живёт до перезапуска приложения.
 *
 * Найденная таблица заодно читается, и запоминается список её листов — для выбора листа в настройках
 * и в поле бирки «Лист». Список хранится на устройстве вместе с расположением таблицы (сервер, папка,
 * путь или папка и имя в Drive): после перезапуска он есть сразу, а после смены таблицы — пуст до проверки.
 */
import { settingsStore } from '@/features/settings/store/SettingsStore'
import type { StorageSettings } from '@/features/settings/store/settingsSchema'
import { appStorage, type KeyValueStore } from '@/lib/storage/KeyValueStore'
import { StoredValue } from '@/lib/storage/StoredValue'
import { Store } from '@/lib/store/Store'
import { isRecord, isString } from '@/lib/validation/guards'
import { toUploadError, type UploadError } from '../UploadError'
import type { TableProbeResult } from '../worker/TableBackend'
import { listTableSheets, probeTable } from '../queue/appBackends'

/** Итог проверки. */
export type TableCheckResult =
  /** Таблица есть. */
  | { kind: 'found'; size: number; modifiedAt: number }
  /** Подключение есть, таблицы нет — запись невозможна. */
  | { kind: 'missing' }
  /** Проверить не удалось: нет сети, неверный пароль, нет общей папки и т. п. */
  | { kind: 'failed'; error: UploadError }

/** Состояние проверки. */
export interface TableCheckState {
  /** Настройки, для которых получен `result` (или идёт проверка); `null` — проверки не было. */
  storage: StorageSettings | null
  /** Проверка идёт. */
  checking: boolean
  /** Итог последней завершённой проверки. */
  result: TableCheckResult | null
  /** Листы таблицы и её расположение (`tableLocation`), для которого они прочитаны. */
  sheets: { location: string; names: string[] } | null
}

/** Расположение таблицы — ключ списка листов: меняется вместе с сервером, папкой, путём или именем файла. */
export function tableLocation(storage: StorageSettings): string {
  const { smb, googleDrive } = storage
  return storage.target === 'smb'
    ? ['smb', smb.host, smb.share, smb.filePath].join('|').toLowerCase()
    : ['googleDrive', googleDrive.account, googleDrive.folder, googleDrive.fileName].join('|')
}

/**
 * Те же ли это хранилище и таблица (лист не в счёт: выбор листа не меняет, есть ли таблица).
 * Настройки неизменяемы — сначала быстрая проверка по ссылке.
 */
export function sameTable(a: StorageSettings | null, b: StorageSettings): boolean {
  if (a === b) return true
  return a !== null && a.target === b.target && JSON.stringify([a.smb, a.googleDrive]) === JSON.stringify([b.smb, b.googleDrive])
}

/** Читает сохранённый список листов. */
const parseSheets = (data: unknown): TableCheckState['sheets'] =>
  isRecord(data) && isString(data.location) && Array.isArray(data.names) && data.names.every(isString)
    ? { location: data.location, names: data.names }
    : null

/** Подключается к хранилищу и сообщает, есть ли таблица. */
export type TableProbe = (storage: StorageSettings) => Promise<TableProbeResult>

/** Читает список листов таблицы. */
export type SheetLister = (storage: StorageSettings) => Promise<string[]>

/** Последняя проверка таблицы. */
export class TableCheckStore extends Store<TableCheckState> {
  /** Проверка хранилища. */
  private readonly probe: TableProbe
  /** Чтение списка листов. */
  private readonly listSheets: SheetLister
  /** Сохранённый список листов. */
  private readonly storedSheets: StoredValue<NonNullable<TableCheckState['sheets']>>

  /**
   * @param probe Проверка хранилища.
   * @param listSheets Чтение списка листов найденной таблицы.
   * @param storage Где хранится список листов.
   */
  constructor(probe: TableProbe, listSheets: SheetLister, storage: KeyValueStore = appStorage) {
    const storedSheets = new StoredValue(storage, 'somascan.tableSheets.v1', parseSheets)
    super({ storage: null, checking: false, result: null, sheets: storedSheets.read() })
    this.probe = probe
    this.listSheets = listSheets
    this.storedSheets = storedSheets
  }

  /** Проверяет таблицу по текущим настройкам хранилища; итог — в состоянии и в ответе. */
  async check(): Promise<TableCheckResult> {
    const { storage } = settingsStore.getSnapshot()
    this.setState((state) => ({ ...state, storage, checking: true, result: null }))
    let result: TableCheckResult
    let sheets: string[] | null = null
    try {
      const table = await this.probe(storage)
      result = table.exists ? { kind: 'found', size: table.size, modifiedAt: table.modifiedAt } : { kind: 'missing' }
      // Таблица есть — читаем её листы; не вышло — остаётся прежний список (проверка всё равно прошла).
      if (table.exists) sheets = await this.listSheets(storage).catch(() => null)
    } catch (error) {
      result = { kind: 'failed', error: toUploadError(error) }
    }
    const listed = sheets && { location: tableLocation(storage), names: sheets }
    if (listed) this.storedSheets.write(listed)
    // Пока шла проверка, могла начаться другая (по другим настройкам) — её не затираем.
    this.setState((state) => (state.storage === storage ? { ...state, checking: false, result, sheets: listed ?? state.sheets } : state))
    return result
  }

  /**
   * Известные листы таблицы с этими настройками (из последней проверки) или пустой список.
   * РИСК: это снимок на момент проверки — лист, переименованный или удалённый в Excel позже, останется
   * в списке до следующей проверки (запись в него получит `sheetNotFound`).
   */
  sheetsFor(storage: StorageSettings): string[] {
    const { sheets } = this.getSnapshot()
    return sheets && sheets.location === tableLocation(storage) ? sheets.names : []
  }

  /** Итог проверки этих настроек или `null`, если их не проверяли (или проверка ещё идёт). */
  resultFor(storage: StorageSettings): TableCheckResult | null {
    const state = this.getSnapshot()
    return sameTable(state.storage, storage) ? state.result : null
  }
}

/** Проверка таблицы приложения. */
export const tableCheckStore = new TableCheckStore(probeTable, listTableSheets)
