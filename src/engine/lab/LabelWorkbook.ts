/**
 * Журнал проб Probe как его пишет мобильное приложение Somascan: бирка дописывается в лист года (или свой лист)
 * в первую строку после последней заполненной, с номером «Nr. Crt.», датой поступления и колонками своих полей.
 * Перенесено из мобильного приложения (`features/uploads/xlsx/LabelWorkbook.ts`) — менять вместе с ним.
 *
 * Здесь им пользуется мост с телефонами (`ProbeBridge`): телефоны без доступа к сети компании пишут бирки в копию
 * Probe на Google Drive, а движок переносит их в Probe на сетевом диске той же строкой, что записал бы телефон.
 *
 * Какие бирки уже записаны, помнит скрытый служебный лист (`JOURNAL_SHEET`, `veryHidden`): номер записи → лист,
 * строка, время и сама бирка (поля и колонки, JSON). По нему мост находит в копии бирки, которых ещё нет в Probe.
 *
 * Все остальные листы, строки, стили, объединения, ширины и фильтры сохраняются; чужие ячейки не перезаписываются.
 */
import ExcelJS from 'exceljs'
import type { Cell, Workbook, Worksheet } from 'exceljs'
import { message, MessageError, type MessageCode } from '@/shared/messages'
import { findCell, keepDefaultWidths, mergedRanges, moveSheetFirst } from './excelInternals'
import { arrivalDateText, labCell } from './labTableCells'
import { dataColumnsOf, findLabLayout, strictMismatch, type FieldColumnHeader, type LabLayout } from './labTableLayout'
import { cellText, readCell, toTableCell, type TableCell } from './tableCell'
import { HEAT_KEY, heatKey, SHEET_KEY, type UploadColumn } from './labelValues'

/**
 * Имя скрытого служебного листа с номерами записанных бирок.
 * РИСК: защита от повторной строки после обрыва держится на этом листе. Если его удалят (например,
 * скопировав журнал в новую книгу без скрытых листов), уже записанные бирки при повторе допишутся снова.
 */
export const JOURNAL_SHEET = 'somascan-journal'

/** Колонки служебного листа: номер записи, лист, строка, время записи, бирка (JSON: поля и колонки). */
export const JOURNAL_HEADER = ['record', 'sheet', 'row', 'written_at', 'entry'] as const

/** Формат ячеек с датой и с датой-временем (для своих колонок вида «дата»). */
const DATE_FORMAT = 'yyyy-mm-dd'
const DATE_TIME_FORMAT = 'yyyy-mm-dd hh:mm:ss'

/** Сырой буфер ExcelJS (Node `Buffer`) как `Uint8Array`. */
const toBytes = (buffer: ArrayBuffer | Uint8Array): Uint8Array =>
  buffer instanceof Uint8Array ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new Uint8Array(buffer)

/** Глубокая копия стиля ячейки (стиль ExcelJS — обычный JSON-объект). */
const cloneStyle = <T>(style: T): T => JSON.parse(JSON.stringify(style ?? {})) as T

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

/** Лист года: имя — четыре цифры. */
const isYearSheet = (sheet: Worksheet) => /^\d{4}$/.test(sheet.name)

/** Текст ячейки листа (строка и колонка с единицы), не создавая ячеек. */
const readerOf = (sheet: Worksheet) => (row: number, column: number) => cellText(findCell(sheet, row, column)?.value ?? null)

/** Свои поля бирки из колонок записи (служебные колонки прежних версий пропускаются). */
const fieldHeadersOf = (columns: readonly UploadColumn[]): FieldColumnHeader[] =>
  columns.filter((column) => !column.key.startsWith('_')).map((column) => ({ key: column.key, aliases: [column.key, column.header, ...column.aliases] }))

/** Что записывается: бирка с номером записи и колонками на момент «Далее». */
export interface LabEntry {
  /** Собственный номер записи (`SCN-…`) — по нему находится строка при повторе и проверке. */
  localNumber: string
  /** Поля бирки. */
  label: Record<string, string | number | null>
  /** Колонки записи: по ним находятся колонки своих полей. */
  columns: readonly UploadColumn[]
}

/** Правила записи из настроек хранилища; не заданные — выключены (и лист — лист года). */
export interface AppendOptions {
  /** Лист из настроек хранилища; пусто — лист года. Свой лист бирки (поле «Лист») важнее. */
  sheet?: string
  /** Строгое строение: все колонки журнала по порядку (`strictMismatch`), иначе `layoutMismatch`. */
  strict?: boolean
  /** Каждая плавка — один раз: плавка, которая уже есть в журнале, — `duplicateHeat`. */
  uniqueHeat?: boolean
}

/** Где лежит записанная строка. */
export interface RowLocation {
  /** Имя листа. */
  sheet: string
  /** Номер строки (с единицы). */
  row: number
}

/** Подготовленная к записи строка: место и значения по номерам колонок (только непустые). */
export interface PlannedRow extends RowLocation {
  /** Значения по номерам колонок. */
  cells: Map<number, TableCell>
  /** Номер элемента в журнале («Nr. Crt.» записанной строки) или `null`, если колонки нет. */
  item: number | null
  /** Лист года создан этой записью (вместе с шапкой). */
  newSheet: boolean
}

/** Номер элемента из ячейки «Nr. Crt.»: целое положительное число (в журнале бывает и текстом). */
function itemOf(cell: TableCell): number | null {
  const value = typeof cell === 'number' ? cell : typeof cell === 'string' ? Number(cell.trim()) : Number.NaN
  return Number.isInteger(value) && value > 0 ? value : null
}

/** Значения всех непустых ячеек книги: ключ `лист!строка:колонка` → текст. */
export type WorkbookSnapshot = Map<string, string>

/** Почему бирку не записать: код сообщения `lab.*` (окно переводит его само). */
export type LabErrorCode = 'corrupt' | 'sheetNotFound' | 'unknownLayout' | 'layoutMismatch' | 'duplicateHeat'

/** Бирку не записать (или книга не открылась). */
export class LabError extends MessageError {
  readonly code: LabErrorCode
  constructor(code: LabErrorCode, detail: string) {
    super(message(`lab.${code}` as MessageCode, { detail }))
    this.name = 'LabError'
    this.code = code
  }
}

/** Запись служебного листа: какую бирку, куда и когда записали. */
export interface JournalRecord {
  /** Номер записи (`SCN-…`). */
  record: string
  /** Лист и строка, куда её записали. */
  sheet: string
  row: number
  /** Момент записи, мс. */
  writtenAt: number
  /** Сама бирка; `null` — запись прежней версии приложения (без бирки) или испорченная. */
  entry: LabEntry | null
}

/** Бирка из ячейки служебного листа (JSON `{ label, columns }`) или `null`. */
function parseEntry(record: string, text: string): LabEntry | null {
  try {
    const raw = JSON.parse(text) as { label?: unknown; columns?: unknown }
    if (typeof raw.label !== 'object' || raw.label === null || Array.isArray(raw.label) || !Array.isArray(raw.columns)) return null
    const label: LabEntry['label'] = {}
    for (const [key, value] of Object.entries(raw.label)) {
      if (value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) label[key] = value
    }
    const columns = raw.columns.filter((c): c is UploadColumn => typeof c === 'object' && c !== null && typeof c.key === 'string' && typeof c.kind === 'string')
      .map((c) => ({ key: c.key, kind: c.kind, header: typeof c.header === 'string' ? c.header : c.key, aliases: Array.isArray(c.aliases) ? c.aliases.filter((x): x is string => typeof x === 'string') : [] }))
    return { localNumber: record, label, columns }
  } catch {
    return null
  }
}

/** Ключ ячейки в снимке. */
export const snapshotKey = (sheet: string, row: number, column: number) => `${sheet}!${row}:${column}`

/** Книга журнала. */
export class LabelWorkbook {
  /** Книга ExcelJS. */
  private readonly workbook: Workbook
  /** Откуда брать стиль первой строки данных у листа, созданного для нового года. */
  private readonly styleSources = new Map<string, { sheet: Worksheet; row: number }>()

  private constructor(workbook: Workbook) {
    this.workbook = workbook
  }

  /**
   * Открывает книгу.
   * @param name Имя файла для сообщения об ошибке.
   * @throws {LabError} `corrupt`, если байты не являются книгой `.xlsx`.
   */
  static async open(bytes: Uint8Array, name = ''): Promise<LabelWorkbook> {
    const workbook = new ExcelJS.Workbook()
    try {
      // Типы ExcelJS ждут `Buffer`, но принимают любой массив байтов.
      await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
    } catch (error) {
      throw new LabError('corrupt', `${name}${name ? ': ' : ''}${error instanceof Error ? error.message : String(error)}`)
    }
    keepDefaultWidths(workbook)
    return new LabelWorkbook(workbook)
  }

  /** Имена видимых листов в порядке книги. */
  get sheetNames(): string[] {
    return this.workbook.worksheets.filter((sheet) => sheet.state === 'visible').map((sheet) => sheet.name)
  }

  /** Где записана бирка с этим номером, или `null`, если её в журнале нет. */
  locate(localNumber: string): RowLocation | null {
    const journal = this.workbook.getWorksheet(JOURNAL_SHEET)
    if (!journal) return null
    let found: RowLocation | null = null
    journal.eachRow((row, number) => {
      if (found || number === 1 || cellText(row.findCell(1)?.value ?? null) !== localNumber) return
      const sheet = cellText(row.findCell(2)?.value ?? null)
      const at = Number(cellText(row.findCell(3)?.value ?? null))
      if (this.workbook.getWorksheet(sheet) && Number.isInteger(at) && at > 0) found = { sheet, row: at }
    })
    return found
  }

  /** Записи служебного листа по порядку (шапка пропускается). */
  journalRecords(): JournalRecord[] {
    const journal = this.workbook.getWorksheet(JOURNAL_SHEET)
    if (!journal) return []
    const records: JournalRecord[] = []
    journal.eachRow((row, number) => {
      const record = cellText(row.findCell(1)?.value ?? null).trim()
      if (number === 1 || !record) return
      const at = Date.parse(cellText(row.findCell(4)?.value ?? null))
      const text = cellText(row.findCell(5)?.value ?? null)
      records.push({
        record,
        sheet: cellText(row.findCell(2)?.value ?? null),
        row: Number(cellText(row.findCell(3)?.value ?? null)) || 0,
        writtenAt: Number.isFinite(at) ? at : 0,
        entry: text ? parseEntry(record, text) : null,
      })
    })
    return records
  }

  /**
   * Дописывает бирку в выбранный лист — свой лист бирки (поле «Лист») или лист из настроек хранилища,
   * а если лист не выбран — в лист года записи (его нет — создаётся).
   * @param entry Бирка, номер записи и колонки.
   * @param writtenAt Момент записи: от него — год (лист) и «Data intrare».
   * @param options Лист из настроек и правила записи.
   * @throws {LabError} `sheetNotFound`, если выбранного листа в книге нет; `unknownLayout`, если на листе
   *   не нашлось шапки журнала; `layoutMismatch`, если строение строгое, а лист с ним не совпадает;
   *   `duplicateHeat`, если плавки уникальны, а такая уже есть в журнале.
   */
  append(entry: LabEntry, writtenAt: number, { sheet: defaultSheet = '', strict = false, uniqueHeat = false }: AppendOptions = {}): PlannedRow {
    // РИСК: год листа (и «Data intrare») — по часам телефона, записавшего бирку: с неверной датой на телефоне
    // бирка уйдёт не в тот лист.
    const year = new Date(writtenAt).getFullYear()
    const fields = fieldHeadersOf(entry.columns)
    const own = entry.label[SHEET_KEY]
    const chosen = (typeof own === 'string' && own.trim() !== '' ? own : defaultSheet).trim()
    const existing = this.workbook.getWorksheet(chosen || String(year))
    // Выбранный лист не создаём: бирка ждёт, пока выберут существующий (служебный лист — не журнал).
    if (chosen && (!existing || existing.name === JOURNAL_SHEET)) throw new LabError('sheetNotFound', chosen)
    const sheet = existing ?? this.addYearSheet(year)
    const layout = findLabLayout(readerOf(sheet), fields)
    if (!layout) throw new LabError('unknownLayout', sheet.name)
    if (strict && strictMismatch(layout, readerOf(sheet))) throw new LabError('layoutMismatch', sheet.name)
    const heat = uniqueHeat ? heatKey(entry.label[HEAT_KEY]) : null
    const sameHeat = heat ? this.findHeat(heat) : null
    if (sameHeat) {
      throw new LabError('duplicateHeat', `${String(entry.label[HEAT_KEY]).trim()} — ${sameHeat.sheet}, ${sameHeat.row}`)
    }

    const last = this.lastDataRow(sheet, layout)
    const row = Math.max(last, layout.dataStart - 1) + 1
    const cells = new Map<number, TableCell>()
    for (const [kind, column] of layout.known) {
      const value = kind === 'number'
        ? this.nextNumber(sheet, layout, last)
        : kind === 'arrivalDate'
          ? arrivalDateText(writtenAt)
          : labCell(kind, entry.label)
      if (value !== null) cells.set(column, value)
    }
    for (const [key, column] of layout.fields) {
      const kind = entry.columns.find((candidate) => candidate.key === key)?.kind
      const value = kind === undefined || kind === 'record_number' || kind === 'recorded_at' ? null : toTableCell(kind, entry.label[key])
      if (value !== null) cells.set(column, value)
    }

    this.styleRow(sheet, layout, row)
    const target = sheet.getRow(row)
    for (const [column, value] of cells) writeCell(target.getCell(column), value)
    target.commit()
    LabelWorkbook.extendFilter(sheet, row)
    this.remember(entry, { sheet: sheet.name, row }, writtenAt)
    const numberColumn = layout.known.get('number')
    return { sheet: sheet.name, row, cells, item: numberColumn === undefined ? null : itemOf(cells.get(numberColumn) ?? null), newSheet: !existing }
  }

  /**
   * Где в журнале уже есть эта плавка (`heatKey`) — на любом листе с шапкой журнала, или `null`.
   * Плавки сравниваются без пробелов и регистра; число и такой же текст — одна плавка.
   */
  findHeat(heat: string): RowLocation | null {
    const key = heatKey(heat)
    if (!key) return null
    for (const sheet of this.workbook.worksheets) {
      if (sheet.name === JOURNAL_SHEET) continue
      const layout = findLabLayout(readerOf(sheet))
      const column = layout?.known.get('heat')
      if (!layout || column === undefined) continue
      let found: number | null = null
      sheet.eachRow({ includeEmpty: false }, (row, number) => {
        if (found === null && number >= layout.dataStart && heatKey(cellText(row.findCell(column)?.value ?? null)) === key) found = number
      })
      if (found !== null) return { sheet: sheet.name, row: found }
    }
    return null
  }

  /** Номер элемента («Nr. Crt.») в строке журнала или `null` (нет шапки, колонки или числа). */
  itemAt(location: RowLocation): number | null {
    const sheet = this.workbook.getWorksheet(location.sheet)
    const column = sheet ? findLabLayout(readerOf(sheet))?.known.get('number') : undefined
    if (column === undefined) return null
    return itemOf(this.readCells(location, [column])[0] ?? null)
  }

  /** Значения указанных колонок строки. */
  readCells(location: RowLocation, columns: readonly number[]): TableCell[] {
    const sheet = this.workbook.getWorksheet(location.sheet)
    if (!sheet) return columns.map(() => null)
    const row = sheet.getRow(location.row)
    return columns.map((column) => readCell(row.getCell(column).value))
  }

  /** Снимок значений всех листов (кроме служебного) — для сверки до и после сохранения. */
  snapshot(): WorkbookSnapshot {
    const values: WorkbookSnapshot = new Map()
    for (const sheet of this.workbook.worksheets) {
      if (sheet.name === JOURNAL_SHEET) continue
      sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        row.eachCell({ includeEmpty: false }, (cell, column) => {
          const text = cellText(cell.value)
          if (text !== '') values.set(snapshotKey(sheet.name, rowNumber, column), text)
        })
      })
    }
    return values
  }

  /** Сериализует книгу в `.xlsx`. */
  async toBytes(): Promise<Uint8Array> {
    const buffer = await this.workbook.xlsx.writeBuffer()
    return toBytes(buffer as unknown as ArrayBuffer | Uint8Array)
  }

  /** Последняя строка листа, где есть данные (номер «Nr. Crt.» без данных не считается); 0 — данных нет. */
  private lastDataRow(sheet: Worksheet, layout: LabLayout): number {
    const columns = dataColumnsOf(layout)
    let last = 0
    sheet.eachRow({ includeEmpty: false }, (row, number) => {
      if (number < layout.dataStart) return
      if (columns.some((column) => cellText(row.findCell(column)?.value ?? null).trim() !== '')) last = number
    })
    return last
  }

  /** Следующий «Nr. Crt.»: номер последней строки плюс один (или по счёту строк, если там не число). */
  private nextNumber(sheet: Worksheet, layout: LabLayout, last: number): number {
    const column = layout.known.get('number')
    if (last < layout.dataStart || column === undefined) return 1
    const previous = Number(cellText(findCell(sheet, last, column)?.value ?? null).trim())
    return Number.isInteger(previous) && previous > 0 ? previous + 1 : last - layout.dataStart + 2
  }

  /**
   * Оформляет строку, если она ещё не оформлена (в журнале строки обычно размечены заранее):
   * копирует стили ячеек таблицы и высоту из строки выше, а для первой строки нового листа —
   * из первой строки данных листа, с которого скопирована шапка.
   */
  private styleRow(sheet: Worksheet, layout: LabLayout, row: number) {
    const target = sheet.getRow(row)
    const columns: number[] = []
    for (let column = layout.firstColumn; column <= layout.lastColumn; column++) columns.push(column)
    const isStyled = columns.some((column) => {
      const border = target.getCell(column).border
      return Boolean(border && (border.top || border.bottom || border.left || border.right))
    })
    if (isStyled) return
    const source = row > layout.dataStart
      ? { sheet, row: row - 1 }
      : this.styleSources.get(sheet.name)
    if (!source) return
    const from = source.sheet.getRow(source.row)
    for (const column of columns) {
      const style = from.findCell(column)?.style
      if (style) target.getCell(column).style = cloneStyle(style)
    }
    if (from.height) target.height = from.height
  }

  /** Растягивает автофильтр листа до строки `row`, если он кончается выше. */
  private static extendFilter(sheet: Worksheet, row: number) {
    const filter = sheet.autoFilter
    if (typeof filter !== 'string') return
    const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(filter.replace(/\$/g, ''))
    if (match && Number(match[4]) < row) sheet.autoFilter = `${match[1]}${match[2]}:${match[3]}${row}`
  }

  /**
   * Создаёт лист года первым в книге: шапка (значения, стили, высоты, объединения), ширины колонок,
   * автофильтр и параметры печати — с самого нового листа-года, где нашлась шапка журнала.
   * @throws {LabError} `unknownLayout`, если такого листа нет.
   */
  private addYearSheet(year: number): Worksheet {
    const found = this.yearSource()
    if (!found) throw new LabError('unknownLayout', String(year))
    const { sheet: source, layout } = found

    const sheet = this.workbook.addWorksheet(String(year), {
      properties: cloneStyle(source.properties),
      pageSetup: cloneStyle(source.pageSetup),
      views: [{ state: 'normal' }],
    })
    // Новый год — первым, как в журнале (листы идут от нового года к старому).
    moveSheetFirst(this.workbook, sheet)

    const lastColumn = Math.max(source.columnCount, layout.lastColumn, source.columns?.length ?? 0)
    for (let column = 1; column <= lastColumn; column++) {
      const from = source.getColumn(column)
      const to = sheet.getColumn(column)
      if (from.width !== undefined) to.width = from.width
      if (from.hidden) to.hidden = true
      if (from.style && Object.keys(from.style).length > 0) to.style = cloneStyle(from.style)
    }
    for (let row = 1; row < layout.dataStart; row++) {
      const from = source.getRow(row)
      const to = sheet.getRow(row)
      if (from.height) to.height = from.height
      for (let column = 1; column <= lastColumn; column++) {
        const cell = from.findCell(column)
        if (!cell) continue
        const copy = to.getCell(column)
        copy.style = cloneStyle(cell.style)
        // Подчинённые ячейки объединения не копируем значением — его даст объединение ниже.
        if (cell.isMerged && cell.master !== cell) continue
        if (cell.value !== null && cell.value !== undefined) copy.value = cloneStyle(cell.value)
      }
      to.commit()
    }
    for (const range of mergedRanges(source)) {
      const bottom = Number(/(\d+)$/.exec(range)?.[1])
      if (bottom < layout.dataStart) sheet.mergeCells(range)
    }
    if (typeof source.autoFilter === 'string') {
      const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(source.autoFilter.replace(/\$/g, ''))
      if (match) sheet.autoFilter = `${match[1]}${match[2]}:${match[3]}${layout.dataStart}`
    }
    // Открываться книга будет на новом листе.
    for (const other of this.workbook.worksheets) {
      const views = other.views?.length ? other.views : [{}]
      other.views = views.map((view) => ({ ...view, tabSelected: other === sheet }))
    }
    this.workbook.views = (this.workbook.views?.length ? this.workbook.views : [{}]).map((view) => ({ ...view, activeTab: 0, firstSheet: 0 })) as Workbook['views']
    this.styleSources.set(sheet.name, { sheet: source, row: layout.dataStart })
    return sheet
  }

  /** С какого листа копируется шапка листа нового года: самый новый лист-год (или другой лист) с шапкой журнала. */
  private yearSource(): { sheet: Worksheet; layout: LabLayout } | null {
    const candidates = this.workbook.worksheets
      .filter((sheet) => sheet.name !== JOURNAL_SHEET)
      .sort((a, b) => Number(isYearSheet(b)) - Number(isYearSheet(a)) || b.name.localeCompare(a.name))
    for (const sheet of candidates) {
      const layout = findLabLayout(readerOf(sheet))
      if (layout) return { sheet, layout }
    }
    return null
  }

  /** Отмечает в служебном листе, куда и когда записана бирка, и саму бирку (поля и колонки — JSON). */
  private remember(entry: LabEntry, location: RowLocation, writtenAt: number) {
    let journal = this.workbook.getWorksheet(JOURNAL_SHEET)
    if (!journal) {
      journal = this.workbook.addWorksheet(JOURNAL_SHEET, { state: 'veryHidden' })
      journal.addRow(JOURNAL_HEADER)
    } else if (!cellText(journal.getCell(1, JOURNAL_HEADER.length).value ?? null)) {
      // Лист прежней версии — без колонки бирки.
      journal.getCell(1, JOURNAL_HEADER.length).value = JOURNAL_HEADER.at(-1)!
    }
    const label = JSON.stringify({ label: entry.label, columns: entry.columns })
    journal.addRow([entry.localNumber, location.sheet, location.row, new Date(writtenAt).toISOString(), label])
  }
}
