/**
 * Таблица `.xlsx` с распознанными бирками поверх ExcelJS.
 *
 * Строки дописываются в первый лист существующей книги (все остальные листы, стили и ширины
 * колонок сохраняются), а новая книга создаётся с одним листом и закреплённой строкой заголовков.
 * Колонки находятся по заголовку в первой строке (по любому из известных названий — см.
 * `uploadColumns`), недостающие добавляются в конец, поэтому таблицу можно переименовывать,
 * переставлять и дополнять своими колонками.
 *
 * ExcelJS (≈1 МБ) загружается лениво, при первой записи.
 */
import type { Cell, Row, Workbook, Worksheet } from 'exceljs'
import { UploadError } from '../UploadError'
import { cellText, readCell, type TableCell } from './tableCell'
import type { UploadColumn, UploadColumnKind } from './uploadColumns'

/** Модуль ExcelJS. */
type ExcelModule = typeof import('exceljs')

/** Имя листа новой книги. */
export const DEFAULT_SHEET_NAME = 'Somascan'

/** Соответствие ключа колонки её номеру на листе (с единицы). */
export type ColumnMap = ReadonlyMap<string, number>

/** Наименьшая ширина колонки (в символах) по виду, чтобы дата помещалась целиком. */
const MIN_WIDTH_BY_KIND: Partial<Record<UploadColumnKind, number>> = {
  recorded_at: 20,
  date: 12,
}

/** Формат ячеек с датой и с датой-временем. */
const DATE_FORMAT = 'yyyy-mm-dd'
const DATE_TIME_FORMAT = 'yyyy-mm-dd hh:mm:ss'

/** Загруженный модуль; в сборке Vite это UMD-бандл, у которого класс лежит в `default`. */
let excelModule: Promise<ExcelModule> | null = null

/** Загружает ExcelJS один раз. */
function loadExcel(): Promise<ExcelModule> {
  excelModule ??= import('exceljs').then((loaded) => {
    const module = loaded as unknown as ExcelModule & { default?: ExcelModule }
    return module.default?.Workbook ? module.default : module
  })
  return excelModule
}

/** Заголовок для сравнения: без регистра, лишних пробелов и различий в нормализации Unicode. */
export const normalizeHeader = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

/** Сырой буфер ExcelJS (Node `Buffer` или его полифил в браузере) как `Uint8Array`. */
const toBytes = (buffer: ArrayBuffer | Uint8Array): Uint8Array =>
  buffer instanceof Uint8Array ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new Uint8Array(buffer)

/** Записывает значение в ячейку; даты получают формат показа. */
function writeCell(cell: Cell, value: TableCell) {
  if (value === null) {
    cell.value = null
  } else if (typeof value === 'object') {
    cell.value = value.date
    cell.numFmt = value.precision === 'day' ? DATE_FORMAT : DATE_TIME_FORMAT
  } else {
    cell.value = value
  }
}

/** Книга с листом, в который дописываются бирки. */
export class LabelWorkbook {
  /** Книга ExcelJS. */
  private readonly workbook: Workbook
  /** Лист с данными: первый лист книги. */
  private readonly sheet: Worksheet

  private constructor(workbook: Workbook, sheet: Worksheet) {
    this.workbook = workbook
    this.sheet = sheet
  }

  /** Новая книга с одним пустым листом. */
  static async create(): Promise<LabelWorkbook> {
    const { Workbook } = await loadExcel()
    const workbook = new Workbook()
    workbook.creator = 'Somascan'
    const sheet = workbook.addWorksheet(DEFAULT_SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] })
    return new LabelWorkbook(workbook, sheet)
  }

  /**
   * Открывает существующую книгу.
   * @throws {UploadError} `corruptWorkbook`, если байты не являются книгой `.xlsx`.
   */
  static async open(bytes: Uint8Array): Promise<LabelWorkbook> {
    const { Workbook } = await loadExcel()
    const workbook = new Workbook()
    try {
      // Типы ExcelJS ждут Node `Buffer`, но и в Node, и в браузере принимают любой массив байтов.
      await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
    } catch (error) {
      throw new UploadError('corruptWorkbook', { detail: error instanceof Error ? error.message : String(error) })
    }
    const sheet = workbook.worksheets[0] ?? workbook.addWorksheet(DEFAULT_SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] })
    return new LabelWorkbook(workbook, sheet)
  }

  /** Имя листа с данными. */
  get sheetName(): string {
    return this.sheet.name
  }

  /** Номер последней строки, в которой есть значения (0 — лист пуст). */
  get lastRow(): number {
    let last = 0
    this.sheet.eachRow((_row: Row, number: number) => {
      last = Math.max(last, number)
    })
    return last
  }

  /** Заголовки первой строки по номерам колонок. */
  headers(): Map<number, string> {
    const headers = new Map<number, string>()
    this.sheet.getRow(1).eachCell({ includeEmpty: false }, (cell: Cell, column: number) => {
      const text = cellText(cell.value)
      if (text.trim() !== '') headers.set(column, text)
    })
    return headers
  }

  /**
   * Находит колонки по заголовкам первой строки и создаёт недостающие в конце.
   * Каждая колонка листа достаётся не более чем одному ключу — в порядке `columns`.
   */
  ensureColumns(columns: readonly UploadColumn[]): ColumnMap {
    const byHeader = new Map<string, number>()
    let lastColumn = 0
    for (const [column, text] of this.headers()) {
      byHeader.set(normalizeHeader(text), column)
      lastColumn = Math.max(lastColumn, column)
    }
    const map = new Map<string, number>()
    const assigned = new Set<number>()
    for (const column of columns) {
      const names = [column.header, ...column.aliases].map(normalizeHeader)
      let number = names.map((name) => byHeader.get(name)).find((candidate) => candidate !== undefined && !assigned.has(candidate))
      if (number === undefined) {
        number = ++lastColumn
        const cell = this.sheet.getRow(1).getCell(number)
        cell.value = column.header
        cell.font = { bold: true }
        this.sheet.getColumn(number).width = Math.min(40, Math.max(12, column.header.length + 4))
        byHeader.set(normalizeHeader(column.header), number)
      }
      assigned.add(number)
      // Дата не помещается в узкую колонку — Excel показывает вместо неё «#####». Расширяем колонку
      // с датой до нужной ширины (только расширяем: ширину, заданную пользователем шире, не трогаем).
      const minWidth = MIN_WIDTH_BY_KIND[column.kind]
      if (minWidth !== undefined) {
        const sheetColumn = this.sheet.getColumn(number)
        if ((sheetColumn.width ?? 0) < minWidth) sheetColumn.width = minWidth
      }
      map.set(column.key, number)
    }
    this.sheet.getRow(1).commit()
    return map
  }

  /** Номер первой строки (ниже заголовка), в которой колонка содержит `value`, или `null`. */
  findRow(column: number, value: string): number | null {
    const wanted = normalizeHeader(value)
    let found: number | null = null
    this.sheet.getColumn(column).eachCell({ includeEmpty: false }, (cell: Cell, row: number) => {
      if (found === null && row > 1 && normalizeHeader(cellText(cell.value)) === wanted) found = row
    })
    return found
  }

  /** Дописывает строку после последней непустой; возвращает её номер. */
  appendRow(cells: ReadonlyMap<number, TableCell>): number {
    const number = Math.max(this.lastRow, 1) + 1
    const row = this.sheet.getRow(number)
    for (const [column, value] of cells) writeCell(row.getCell(column), value)
    row.commit()
    return number
  }

  /** Значения указанных колонок в строке `number`. */
  readRow(number: number, columns: readonly number[]): TableCell[] {
    const row = this.sheet.getRow(number)
    return columns.map((column) => readCell(row.getCell(column).value))
  }

  /** Сериализует книгу в `.xlsx`. */
  async toBytes(): Promise<Uint8Array> {
    const buffer = await this.workbook.xlsx.writeBuffer()
    return toBytes(buffer as unknown as ArrayBuffer | Uint8Array)
  }
}
