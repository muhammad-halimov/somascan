/**
 * Запись одной бирки в таблицу — полный цикл с защитой от потери данных, одинаковый для
 * сетевого диска и Google Drive (различия — в `TableBackend`).
 *
 * 1. Блокировка: пока таблицу пишет другое устройство — `busy` (запись повторится).
 * 2. Чтение текущей таблицы (каждый раз заново: её могли изменить в Excel или с другого телефона).
 * 3. Если строка с этим номером записи уже есть — запись считается выполненной (повтор после обрыва).
 * 4. Строка дописывается, книга сериализуется.
 * 5. Атомарная замена в хранилище: прежний файл — в резервную копию, новый сверяется по хешу.
 * 6. Проверка: таблица перечитывается, записанная строка сверяется по каждой ячейке.
 * 7. Резервные копии старше недели удаляются; блокировка снимается.
 */
import type { UploadRecord } from '../store/UploadStore'
import { UploadError } from '../UploadError'
import { BackupPolicy } from '../xlsx/BackupPolicy'
import { LabelWorkbook, type ColumnMap } from '../xlsx/LabelWorkbook'
import { excelDateTime, sameCell, toTableCell, type TableCell } from '../xlsx/tableCell'
import { RECORD_NUMBER_KEY } from '../xlsx/uploadColumns'
import type { TableBackend } from './TableBackend'

/** Итог записи. */
export interface TableWriteResult {
  /** Номер строки в таблице. */
  rowNumber: number
  /** Строка уже была в таблице (повтор после обрыва), ничего не записывалось. */
  duplicate: boolean
}

/** Пишет бирки в таблицу через `TableBackend`. */
export class TableWriter {
  /** Идентификатор устройства — владелец блокировки. */
  private readonly owner: string
  /** Текущее время (подменяется в тестах). */
  private readonly now: () => number

  /**
   * @param owner Идентификатор устройства.
   * @param now Текущее время.
   */
  constructor(owner: string, now: () => number = Date.now) {
    this.owner = owner
    this.now = now
  }

  /**
   * Дописывает запись в таблицу.
   * @throws {UploadError} Любой сбой; по коду `UploadWorker` решает, повторять ли попытку.
   */
  async write(record: UploadRecord, backend: TableBackend): Promise<TableWriteResult> {
    await backend.acquireLock(this.owner)
    try {
      const current = await backend.read()
      const workbook = current ? await LabelWorkbook.open(current) : await LabelWorkbook.create()
      const map = workbook.ensureColumns(record.columns)
      const numberColumn = map.get(RECORD_NUMBER_KEY)
      if (numberColumn === undefined) throw new UploadError('io', { detail: 'record has no number column' })
      const existing = workbook.findRow(numberColumn, record.localNumber)
      if (existing !== null) return { rowNumber: existing, duplicate: true }
      const cells = TableWriter.cellsOf(record, map, this.now())
      const rowNumber = workbook.appendRow(cells)
      const bytes = await workbook.toBytes()
      const policy = new BackupPolicy(backend.stem, backend.extension)
      await backend.replace(bytes, current ? policy.backupName(new Date(this.now())) : undefined)
      await TableWriter.verify(await backend.readBack(), record, cells)
      await backend.pruneBackups(policy, this.now())
      return { rowNumber, duplicate: false }
    } finally {
      await backend.releaseLock()
    }
  }

  /**
   * Ячейки строки по колонкам записи.
   * @param writtenAt Момент записи в таблицу — он попадает в колонку «Дата записи» (а не момент
   *   нажатия «Далее»: без сети запись может уйти в таблицу позже).
   */
  private static cellsOf(record: UploadRecord, map: ColumnMap, writtenAt: number): Map<number, TableCell> {
    const cells = new Map<number, TableCell>()
    for (const column of record.columns) {
      const number = map.get(column.key)
      if (number === undefined) continue
      if (column.kind === 'record_number') cells.set(number, record.localNumber)
      else if (column.kind === 'recorded_at') cells.set(number, excelDateTime(writtenAt))
      else cells.set(number, toTableCell(column.kind, record.label[column.key]))
    }
    return cells
  }

  /**
   * Сверяет записанную строку в перечитанной таблице по каждой ячейке.
   * @throws {UploadError} `verifyFailed`, если строки нет или значения отличаются.
   */
  private static async verify(bytes: Uint8Array, record: UploadRecord, cells: ReadonlyMap<number, TableCell>) {
    const workbook = await LabelWorkbook.open(bytes)
    const map = workbook.ensureColumns(record.columns)
    const numberColumn = map.get(RECORD_NUMBER_KEY)
    const row = numberColumn === undefined ? null : workbook.findRow(numberColumn, record.localNumber)
    if (row === null) throw new UploadError('verifyFailed', { detail: `row ${record.localNumber} not found after save` })
    const columns = [...cells.keys()]
    const actual = workbook.readRow(row, columns)
    columns.forEach((column, index) => {
      if (!sameCell(cells.get(column)!, actual[index]!)) {
        throw new UploadError('verifyFailed', { detail: `column ${column} differs after save` })
      }
    })
  }
}
