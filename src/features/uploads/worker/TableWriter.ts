/**
 * Запись одной бирки в журнал — полный цикл с защитой от потери данных, одинаковый для
 * сетевого диска и Google Drive (различия — в `TableBackend`).
 *
 * 1. Блокировка: пока журнал пишет другое устройство — `busy` (запись повторится).
 * 2. Чтение текущего журнала (каждый раз заново: его могли изменить в Excel или с другого телефона).
 *    Файла нет — новый журнал из пустого шаблона.
 * 3. Если бирка с этим номером записи уже в журнале — запись считается выполненной (повтор после обрыва).
 * 4. Строка дописывается в лист года, книга сериализуется.
 * 5. Сверка до замены: новая книга перечитывается, и все значения, кроме записанной строки,
 *    должны совпасть с прежними — иначе файл на сервере не трогается.
 * 6. Атомарная замена в хранилище: прежний файл — в резервную копию, новый сверяется по хешу.
 * 7. Проверка: журнал перечитывается с сервера, записанная строка сверяется по каждой ячейке.
 * 8. Резервные копии старше недели удаляются; блокировка снимается.
 *
 * Отмена (`signal`) проверяется между шагами до замены файла (6) — после неё бирка уже в журнале,
 * и запись доводится до конца.
 */
import type { UploadRecord } from '../store/UploadStore'
import { UploadError } from '../UploadError'
import { BackupPolicy } from '../xlsx/BackupPolicy'
import { LabelWorkbook, snapshotKey, type PlannedRow, type WorkbookSnapshot } from '../xlsx/LabelWorkbook'
import { sameCell } from '../xlsx/tableCell'
import type { TableBackend } from './TableBackend'

/** Итог записи. */
export interface TableWriteResult {
  /** Лист журнала (год). */
  sheet: string
  /** Номер строки на листе. */
  rowNumber: number
  /** Строка уже была в журнале (повтор после обрыва), ничего не записывалось. */
  duplicate: boolean
}

/** Пустой шаблон журнала (байты `.xlsx`). */
export type TemplateLoader = () => Promise<Uint8Array>

/** Пишет бирки в журнал через `TableBackend`. */
export class TableWriter {
  /** Идентификатор устройства — владелец блокировки. */
  private readonly owner: string
  /** Пустой шаблон журнала — для первой записи, когда файла ещё нет. */
  private readonly template: TemplateLoader
  /** Текущее время (подменяется в тестах). */
  private readonly now: () => number

  /**
   * @param owner Идентификатор устройства.
   * @param template Пустой шаблон журнала.
   * @param now Текущее время.
   */
  constructor(owner: string, template: TemplateLoader, now: () => number = Date.now) {
    this.owner = owner
    this.template = template
    this.now = now
  }

  /**
   * Дописывает запись в журнал.
   * @throws {UploadError} Любой сбой; по коду `UploadWorker` решает, повторять ли попытку.
   */
  async write(record: UploadRecord, backend: TableBackend, signal?: AbortSignal): Promise<TableWriteResult> {
    /** Останавливает запись, если её отменили: до замены файла журнал не тронут. */
    const checkCancelled = () => {
      if (signal?.aborted) throw new UploadError('cancelled')
    }
    checkCancelled()
    await backend.acquireLock(this.owner)
    try {
      checkCancelled()
      const current = await backend.read()
      checkCancelled()
      const writtenAt = this.now()
      const workbook = current
        ? await LabelWorkbook.open(current)
        : await LabelWorkbook.fromTemplate(await this.template(), new Date(writtenAt).getFullYear())
      const existing = workbook.locate(record.localNumber)
      if (existing) return { sheet: existing.sheet, rowNumber: existing.row, duplicate: true }
      const before = workbook.snapshot()
      const planned = workbook.append(record, writtenAt)
      const bytes = await workbook.toBytes()
      await TableWriter.checkIntact(before, bytes, planned)
      checkCancelled()
      const policy = new BackupPolicy(backend.stem, backend.extension)
      await backend.replace(bytes, current ? policy.backupName(new Date(writtenAt)) : undefined)
      await TableWriter.verify(await backend.readBack(), record, planned)
      await backend.pruneBackups(policy, this.now())
      return { sheet: planned.sheet, rowNumber: planned.row, duplicate: false }
    } finally {
      await backend.releaseLock()
    }
  }

  /**
   * Сверяет новую книгу с прежней до замены файла: каждое прежнее значение на месте,
   * новые — только в записанной строке (и в шапке листа нового года, если он создан этой записью).
   * @throws {UploadError} `integrityFailed` — файл на сервере не трогается.
   */
  private static async checkIntact(before: WorkbookSnapshot, bytes: Uint8Array, planned: PlannedRow) {
    const after = (await LabelWorkbook.open(bytes)).snapshot()
    const written = new Set([...planned.cells.keys()].map((column) => snapshotKey(planned.sheet, planned.row, column)))
    for (const [key, value] of before) {
      if (!written.has(key) && after.get(key) !== value) throw new UploadError('integrityFailed', { detail: `cell ${key} would change` })
    }
    for (const key of after.keys()) {
      const inNewSheet = planned.newSheet && key.startsWith(`${planned.sheet}!`)
      if (!before.has(key) && !written.has(key) && !inNewSheet) throw new UploadError('integrityFailed', { detail: `unexpected cell ${key}` })
    }
  }

  /**
   * Сверяет записанную строку в перечитанном журнале по каждой ячейке.
   * @throws {UploadError} `verifyFailed`, если строки нет или значения отличаются.
   */
  private static async verify(bytes: Uint8Array, record: UploadRecord, planned: PlannedRow) {
    const workbook = await LabelWorkbook.open(bytes)
    const location = workbook.locate(record.localNumber)
    if (!location || location.sheet !== planned.sheet || location.row !== planned.row) {
      throw new UploadError('verifyFailed', { detail: `row ${record.localNumber} not found after save` })
    }
    const columns = [...planned.cells.keys()]
    const actual = workbook.readCells(location, columns)
    columns.forEach((column, index) => {
      if (!sameCell(planned.cells.get(column)!, actual[index]!)) {
        throw new UploadError('verifyFailed', { detail: `column ${column} differs after save` })
      }
    })
  }
}
