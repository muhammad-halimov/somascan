/**
 * Журнал проб стали `.xlsx` поверх ExcelJS: в него дописываются распознанные бирки.
 *
 * Книга — по листу на год (`2026`, `2025`, …) с шапкой журнала (см. `labTableLayout`). Бирка
 * записывается в лист года записи — в первую строку после последней заполненной; если листа
 * этого года нет, он создаётся первым в книге с той же шапкой, что у самого нового года.
 * Новых книг приложение не создаёт: пишет только в существующий журнал.
 *
 * Все остальные листы, строки, стили, объединения, ширины и фильтры сохраняются; чужие ячейки
 * не перезаписываются. Перед заменой файла `TableWriter` сверяет все значения книги до и после
 * (`snapshot`), так что повреждение данных при пересохранении не дойдёт до сервера.
 *
 * Какие бирки уже записаны, помнит скрытый служебный лист (`JOURNAL_SHEET`, `veryHidden` —
 * его не видно и в списке скрытых листов Excel): номер записи → лист и строка. По нему повтор
 * после обрыва не дублирует строку, а проверка после сохранения находит записанную строку.
 *
 * ExcelJS (≈1 МБ) загружается лениво, при первой записи.
 */
import type { Cell, Workbook, Worksheet } from 'exceljs'
import { SHEET_KEY } from '@/features/recognition/label/labelFields'
import { UploadError } from '../UploadError'
import { findCell, keepDefaultWidths, mergedRanges, moveSheetFirst } from './excelInternals'
import { arrivalDateText, labCell } from './labTableCells'
import { dataColumnsOf, findLabLayout, type FieldColumnHeader, type LabLayout } from './labTableLayout'
import { cellText, readCell, toTableCell, type TableCell } from './tableCell'
import type { UploadColumn } from './uploadColumns'

/** Модуль ExcelJS. */
type ExcelModule = typeof import('exceljs')

/**
 * Имя скрытого служебного листа с номерами записанных бирок.
 * РИСК: защита от повторной строки после обрыва держится на этом листе. Если его удалят (например,
 * скопировав журнал в новую книгу без скрытых листов), уже записанные бирки при повторе допишутся снова.
 */
export const JOURNAL_SHEET = 'somascan-journal'

/** Формат ячеек с датой и с датой-временем (для своих колонок вида «дата»). */
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

/** Сырой буфер ExcelJS (Node `Buffer` или его полифил в браузере) как `Uint8Array`. */
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

  /**
   * Дописывает бирку в выбранный лист — свой лист бирки (поле «Лист») или лист из настроек хранилища,
   * а если лист не выбран — в лист года записи (его нет — создаётся).
   * @param entry Бирка, номер записи и колонки.
   * @param writtenAt Момент записи: от него — год (лист) и «Data intrare».
   * @param defaultSheet Лист из настроек хранилища; пусто — лист года.
   * @throws {UploadError} `sheetNotFound`, если выбранного листа в книге нет; `unknownLayout`, если на листе
   *   не нашлось шапки журнала.
   */
  append(entry: LabEntry, writtenAt: number, defaultSheet = ''): PlannedRow {
    // РИСК: год листа (и «Data intrare») — по часам устройства: с неверной датой на телефоне бирка уйдёт
    // не в тот лист. Сервер своё время не сообщает, сверить не с чем.
    const year = new Date(writtenAt).getFullYear()
    const fields = fieldHeadersOf(entry.columns)
    const own = entry.label[SHEET_KEY]
    const chosen = (typeof own === 'string' && own.trim() !== '' ? own : defaultSheet).trim()
    const existing = this.workbook.getWorksheet(chosen || String(year))
    // Выбранный лист не создаём: бирка ждёт, пока выберут существующий (служебный лист — не журнал).
    if (chosen && (!existing || existing.name === JOURNAL_SHEET)) throw new UploadError('sheetNotFound', { detail: chosen })
    const sheet = existing ?? this.addYearSheet(year)
    const layout = findLabLayout(readerOf(sheet), fields)
    if (!layout) throw new UploadError('unknownLayout', { detail: sheet.name })

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
    this.remember(entry.localNumber, { sheet: sheet.name, row }, writtenAt)
    const numberColumn = layout.known.get('number')
    return { sheet: sheet.name, row, cells, item: numberColumn === undefined ? null : itemOf(cells.get(numberColumn) ?? null), newSheet: !existing }
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
   * @throws {UploadError} `unknownLayout`, если такого листа нет.
   */
  private addYearSheet(year: number): Worksheet {
    const candidates = this.workbook.worksheets
      .filter((sheet) => sheet.name !== JOURNAL_SHEET)
      .sort((a, b) => Number(isYearSheet(b)) - Number(isYearSheet(a)) || b.name.localeCompare(a.name))
    let source: Worksheet | undefined
    let layout: LabLayout | null = null
    for (const candidate of candidates) {
      layout = findLabLayout(readerOf(candidate))
      if (layout) {
        source = candidate
        break
      }
    }
    if (!source || !layout) throw new UploadError('unknownLayout', { detail: String(year) })

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

  /** Отмечает в служебном листе, куда записана бирка. */
  private remember(localNumber: string, location: RowLocation, writtenAt: number) {
    let journal = this.workbook.getWorksheet(JOURNAL_SHEET)
    if (!journal) {
      journal = this.workbook.addWorksheet(JOURNAL_SHEET, { state: 'veryHidden' })
      journal.addRow(['record', 'sheet', 'row', 'written_at'])
    }
    journal.addRow([localNumber, location.sheet, location.row, new Date(writtenAt).toISOString()])
  }
}
