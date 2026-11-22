/**
 * Таблица лаборатории (`Laborator.xlsx`, «Evidenta rezultatelor incercarilor efectuate pe cuburile de proba din
 * beton»): журнал испытаний кубиков бетона, строка на элемент. Лист — тот, где в первых строках есть шапка
 * с «Rc decofr.»; через несколько колонок — «Rc 28 zile» и справа от неё колонка бюллетеня.
 *
 * Прежний вид — прочность, номер бюллетеня и дата в одной ячейке:
 *
 *     Rc decofr.↵Nr.bul./↵Data | … | Rc 28 zile | Nr.bul./Data
 *     32.8↵1B/09.01.2026       |   | 63.2       | 1B/05.02.2026
 *
 * Разделённый (`split`) — бюллетень и дата в своих колонках:
 *
 *     Rc decofr. | Nr.bul. | Data       | … | Rc 28 zile | Nr.bul. | Data
 *     32.8       | 1B      | 09.01.2026 |   | 63.2       | 1B      | 05.02.2026
 *
 * Прочность пишется числом (`0.0`), дата — датой Excel (`dd.mm.yyyy`, видна так же, как была). Колонки вставляются
 * со стилем соседней ячейки той же строки; объединения, ширины, фильтр и область печати сдвигаются вместе с ними.
 * Шапку и колонки находит `findHeader` (`LabHeader`) — так же, как проверка таблицы в «Хранилище».
 *
 * РИСК: ячейка с опечаткой («37..5», «18.08.02026», «020.10.2026») не делится — остаётся как была, причина — в журнале.
 */
import ExcelJS from 'exceljs'
import { message, MessageError } from '@/shared/messages'
import { cellText, cellValue, columnLetters, columnNumber, copyStyle, decodeRange, setStyle } from '../Cells'
import { definedNameRanges, keepDefaultWidths, mergedRanges, replaceDefinedName } from '../lab/excelInternals'
import { findHeader, HEADER_ROWS, type SheetHead, type SplitColumn } from './LabHeader'

export type { SplitColumn } from './LabHeader'

/** Заголовки колонок, которые появляются при разделении. */
export const BULLETIN_HEADER = 'Nr.bul.'
export const DATE_HEADER = 'Data'

/** Форматы разделённых ячеек: прочность и дата. */
const VALUE_FORMAT = '0.0'
const DATE_FORMAT = 'dd.mm.yyyy'

/** Ширина вставленной колонки. */
const NEW_WIDTH = 14

/** Имя книги с диапазоном фильтра. */
const FILTER_NAME = '_xlnm._FilterDatabase'

/** Разобранная ячейка: прочность (только у «Rc decofr.»), номер бюллетеня и дата — любой части может не быть. */
export interface ParsedResult {
  value: number | null
  bulletin: string | null
  date: Date | null
}

/** Дата «09.01.2026» / «09.01.26» (в UTC, как даты Excel) или `null`, если такого дня нет. */
function calendarDate(day: string, month: string, year: string): Date | null {
  const y = year.length === 2 ? 2000 + Number(year) : Number(year)
  const date = new Date(Date.UTC(y, Number(month) - 1, Number(day)))
  return date.getUTCDate() === Number(day) && date.getUTCMonth() === Number(month) - 1 ? date : null
}

/**
 * Разбирает ячейку «прочность / бюллетень / дата»: «32.8↵1B/09.01.2026» → 32.8, «1B», 09.01.2026; «28↵13.01.2026» —
 * без бюллетеня, «31.9↵15B/» — без даты.
 * @param withValue В начале ячейки — прочность.
 * @returns `null`, если после разбора остался непонятный текст («37..5», «18.08.02026»): такую ячейку не делим.
 */
export function parseResult(raw: string, withValue: boolean): ParsedResult | null {
  let rest = raw.replace(/\\/g, '').trim()
  let value: number | null = null
  if (withValue) {
    const m = /^(\d+(?:[.,]\d+)?)(?=[\s/]|$)/.exec(rest)
    if (m) {
      value = Number(m[1]!.replace(',', '.'))
      rest = rest.slice(m[0].length)
    }
  }
  let date: Date | null = null
  const dm = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?![\d.])/.exec(rest)
  if (dm) {
    date = calendarDate(dm[1]!, dm[2]!, dm[3]!)
    if (date) rest = rest.replace(dm[0], ' ')
  }
  let bulletin: string | null = null
  const bm = /(?<![\w.])(\d+)\s*([A-Za-z]+)(?![\w.])/.exec(rest)
  if (bm) {
    bulletin = `${bm[1]}${bm[2]}`
    rest = rest.replace(bm[0], ' ')
  }
  // между частями — только переносы, пробелы и косые черты
  if (rest.replace(/[\s/]+/g, '')) return null
  return { value, bulletin, date }
}

/** Дата разделённой ячейки текстом, как в таблице: «09.01.2026». */
export const dateLabel = (date: Date): string =>
  `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${date.getUTCFullYear()}`

/** Сколько колонок вставляется справа от делимой. */
const inserted = (split: SplitColumn) => (split.withValue ? 2 : 1)

/** Где что в таблице. */
export interface LabLayout {
  sheet: ExcelJS.Worksheet
  /** Строка шапки. */
  header: number
  /** Колонка «Rc decofr.» в таблице как она есть: в разделённой справа от неё — «Nr.bul.» и «Data». */
  decofr: number
  /** Колонки, которые ещё не разделены, по возрастанию; пусто — таблица уже разделена. */
  splits: SplitColumn[]
}

/** Ячейка, которая делится. */
export interface CellSplit {
  row: number
  split: SplitColumn
  parsed: ParsedResult
}

/** Ячейка, которая остаётся как была: не разобрана или объединена с соседними. */
export interface KeptCell {
  row: number
  split: SplitColumn
  text: string
  why: 'unparsed' | 'merged'
}

/** Что сделает разделение. */
export interface SplitPlan {
  cells: CellSplit[]
  kept: KeptCell[]
  /** Строк данных под шапкой. */
  rows: number
}

/** Колонка после разделения: правее каждой разделённой колонки вставлены новые. */
export function finalColumn(layout: LabLayout, column: number): number {
  return column + layout.splits.filter((s) => s.column < column).reduce((n, s) => n + inserted(s), 0)
}

/** Адрес ячейки после разделения: «O16». */
export const finalAddress = (layout: LabLayout, row: number, column: number): string => `${columnLetters(finalColumn(layout, column))}${row}`

/** Таблица лаборатории. */
export class LaboratorBook {
  readonly workbook: ExcelJS.Workbook

  private constructor(workbook: ExcelJS.Workbook) {
    this.workbook = workbook
  }

  /** Читает книгу из байтов. */
  static async open(bytes: Uint8Array): Promise<LaboratorBook> {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer)
    return new LaboratorBook(workbook)
  }

  /**
   * Находит шапку и колонки (`findHeader`) по первым строкам листов.
   * @throws {MessageError} Шапки нет или она не похожа ни на прежний, ни на разделённый вид.
   */
  layout(): LabLayout {
    const sheets = this.workbook.worksheets
    const heads: SheetHead[] = sheets.map((sheet) => {
      const rows = new Map<number, Map<number, string>>()
      for (let r = 1; r <= Math.min(HEADER_ROWS, sheet.rowCount); r++) {
        const cells = new Map<number, string>()
        sheet.getRow(r).eachCell((cell, c) => {
          const value = cellValue(cell)
          if (value !== null && !(value instanceof Date)) cells.set(c, String(value))
        })
        if (cells.size) rows.set(r, cells)
      }
      return { name: sheet.name, rows }
    })
    const { sheet, header, decofr, splits } = findHeader(heads)
    return { sheet: sheets[sheet]!, header, decofr, splits }
  }

  /**
   * Что разделится: ячейки под шапкой в делимых колонках. Пустые пропускаются; объединённые с соседними
   * и неразобранные остаются как были.
   * @throws {MessageError} На листе есть формулы: при сдвиге колонок их ссылки не исправляются.
   */
  plan(layout: LabLayout): SplitPlan {
    const { sheet, header, splits } = layout
    const formula = this.firstFormula(sheet)
    if (formula) throw new MessageError(message('laborator.formulas', { cell: formula }))
    const merged = mergedRanges(sheet).map(decodeRange).filter((m) => m.r2 > header)
    const cells: CellSplit[] = []
    const kept: KeptCell[] = []
    for (let row = header + 1; row <= sheet.rowCount; row++) {
      for (const split of splits) {
        const value = cellValue(sheet.getCell(row, split.column))
        const text = value instanceof Date ? dateLabel(value) : value === null ? '' : String(value).trim()
        if (!text) continue
        if (merged.some((m) => row >= m.r1 && row <= m.r2 && split.column >= m.c1 && split.column <= m.c2)) {
          kept.push({ row, split, text, why: 'merged' })
          continue
        }
        const parsed = value instanceof Date ? null : parseResult(text, split.withValue)
        if (parsed) cells.push({ row, split, parsed })
        else kept.push({ row, split, text, why: 'unparsed' })
      }
    }
    return { cells, kept, rows: Math.max(0, sheet.rowCount - header) }
  }

  /** Делит таблицу по плану: вставляет колонки, пишет шапку и разобранные ячейки. */
  split(layout: LabLayout, plan: SplitPlan): void {
    const { sheet, header } = layout
    // справа налево: номера левых колонок не меняются от вставки правее
    for (const split of [...layout.splits].reverse()) this.insertColumns(sheet, split.column, inserted(split))
    const head = sheet.getRow(header)
    for (const split of layout.splits) {
      const at = finalColumn(layout, split.column)
      if (split.withValue) {
        head.getCell(at).value = split.title
        head.getCell(at + 1).value = BULLETIN_HEADER
        head.getCell(at + 2).value = DATE_HEADER
      } else {
        head.getCell(at).value = BULLETIN_HEADER
        head.getCell(at + 1).value = DATE_HEADER
      }
    }
    for (const { row, split, parsed } of plan.cells) {
      const at = finalColumn(layout, split.column)
      const cells = split.withValue ? [sheet.getCell(row, at), sheet.getCell(row, at + 1), sheet.getCell(row, at + 2)] : [null, sheet.getCell(row, at), sheet.getCell(row, at + 1)]
      const [valueCell, bulletinCell, dateCell] = cells
      if (valueCell) {
        valueCell.value = parsed.value
        if (parsed.value !== null) setStyle(valueCell, { numFmt: VALUE_FORMAT })
      }
      bulletinCell!.value = parsed.bulletin
      dateCell!.value = parsed.date
      if (parsed.date) setStyle(dateCell!, { numFmt: DATE_FORMAT })
    }
    keepDefaultWidths(this.workbook)
  }

  /** Книга в байтах. */
  async toBytes(): Promise<Uint8Array> {
    return new Uint8Array(await this.workbook.xlsx.writeBuffer())
  }

  /** Значения всех непустых ячеек всех листов: «лист!строка:колонка» → текст (сверка до и после записи). */
  snapshot(): Map<string, string> {
    const out = new Map<string, string>()
    for (const sheet of this.workbook.worksheets) {
      sheet.eachRow((row, r) => {
        row.eachCell((cell, c) => {
          const text = cellText(cell)
          if (text) out.set(`${sheet.name}!${r}:${c}`, text)
        })
      })
    }
    return out
  }

  /** Адрес первой формулы листа или `null`. */
  private firstFormula(sheet: ExcelJS.Worksheet): string | null {
    let found: string | null = null
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (!found && cell.type === ExcelJS.ValueType.Formula) found = cell.address
      })
    })
    return found
  }

  /**
   * Вставляет `count` пустых колонок справа от колонки `after`. Значения и стили правее сдвигаются, ширины —
   * тоже; объединения, фильтр и область печати сдвигаются, а если колонка `after` внутри них — растягиваются.
   * Новые ячейки берут стиль ячейки `after` своей строки: рамки таблицы продолжаются.
   */
  private insertColumns(sheet: ExcelJS.Worksheet, after: number, count: number): void {
    const at = after + 1
    const merges = mergedRanges(sheet).map(decodeRange)
    for (const m of merges) sheet.unMergeCells(m.ref)
    const lastColumn = sheet.columnCount
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r)
      for (let c = lastColumn; c >= at; c--) {
        const from = row.getCell(c)
        const to = row.getCell(c + count)
        to.value = from.value
        copyStyle(from, to)
      }
      for (let k = 0; k < count; k++) {
        const cell = row.getCell(at + k)
        cell.value = null
        copyStyle(row.getCell(after), cell)
      }
    }
    for (let c = Math.max(lastColumn, sheet.columns?.length ?? 0); c >= at; c--) {
      const from = sheet.getColumn(c)
      const to = sheet.getColumn(c + count)
      to.width = from.width
      to.hidden = from.hidden
    }
    for (let k = 0; k < count; k++) {
      const column = sheet.getColumn(at + k)
      column.width = NEW_WIDTH
      column.hidden = false
    }
    // объединение растягивается, только если вставка внутри него (как в Excel)
    const shift = (c: number) => (c >= at ? c + count : c)
    for (const m of merges) sheet.mergeCells(m.r1, shift(m.c1), m.r2, shift(m.c2))
    // фильтр и область печати растягиваются и тогда, когда колонка `after` — их последняя
    const widen = (range: string): string => {
      const m = /^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(range)
      if (!m) return range
      const c1 = columnNumber(m[1]!)
      const c2 = columnNumber(m[3]!)
      return `${columnLetters(c1 >= at ? c1 + count : c1)}${m[2]}:${columnLetters(c2 >= after ? c2 + count : c2)}${m[4]}`
    }
    const filter = sheet.autoFilter
    if (typeof filter === 'string') sheet.autoFilter = widen(filter)
    if (sheet.pageSetup.printArea) sheet.pageSetup.printArea = sheet.pageSetup.printArea.split(',').map(widen).join(',')
    // диапазон фильтра продублирован именем книги — оно должно совпадать с фильтром
    if (typeof sheet.autoFilter === 'string' && definedNameRanges(this.workbook, FILTER_NAME).length) {
      const [from, to] = sheet.autoFilter.split(':')
      const absolute = (ref: string) => ref.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2')
      const name = /^[A-Za-z_][\w.]*$/.test(sheet.name) ? sheet.name : `'${sheet.name.replace(/'/g, "''")}'`
      replaceDefinedName(this.workbook, FILTER_NAME, [`${name}!${absolute(from!)}:${absolute(to!)}`])
    }
  }
}
