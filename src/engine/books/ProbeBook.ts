/**
 * Probe (журнал проб): плавки, сколько пришло, какие закрыты; закраска израсходованных плавок жёлтым.
 *
 * Читается лист текущего года (или листы из настроек). В январе, пока лист нового года пуст, добавляется
 * и прошлый год. Колонки ищутся по шапке (строки 4–6). Плавка закрыта, если все её строки залиты жёлтым.
 * Скрытый лист `sync-journal` помнит, какие плавки закрасила сама программа: только их она может открыть обратно.
 *
 * РИСК: колонки находятся по словам шапки (Cantitatea, Sarja, Producator, Bobina, Bara) — переименованная шапка
 * выключает лист (в журнале «не нашёл колонки»).
 */
import ExcelJS from 'exceljs'
import { message, type Message } from '@/shared/messages'
import { cellText, cellValue, hasFill, setStyle, toNumber } from '../Cells'

/** Жёлтая заливка = плавка закрыта. */
export const YELLOW = 'FFFFFF00'
/** Скрытый лист Probe: какие плавки закрасила программа. */
export const JOURNAL_SHEET = 'sync-journal'

/** Форма плавки. */
export type HeatForm = 'Bobina' | 'Bara'

/** Плавка. */
export interface Heat {
  sarja: string
  producer: string
  dia: number
  form: HeatForm
  /** Пришло, кг (сумма строк). */
  supplied: number
  /** Где плавка в журнале. */
  rows: Array<{ sheet: string; row: number; yellow: boolean }>
  /** Все строки жёлтые. */
  closed: boolean
  /** Порядок появления в журнале. */
  order: number
}

/** Плавки и закрашенные программой (всё, что нужно для расчёта остатков). */
export interface ProbeHeats {
  heats: Map<string, Heat>
  /** Плавки, закрашенные программой. */
  journal: Set<string>
}

/** Какие листы читать. */
export interface ProbeSheetsOptions {
  sheets: string[]
  /** Листы заданы явно (иначе в январе добавляется прошлый год). */
  explicit: boolean
  year: number
}

/** Колонка по тексту шапки. */
function findColumn(ws: ExcelJS.Worksheet, re: RegExp, rows = [4, 5, 6]): number | null {
  for (const r of rows) for (let c = 1; c <= 15; c++) if (re.test(cellText(ws.getCell(r, c)))) return c
  return null
}

/** Колонка «Sarja» листа (последнее совпадение в строках 4–6, как при чтении в прежних версиях). */
function sarjaColumn(ws: ExcelJS.Worksheet): number | null {
  let found: number | null = null
  for (const r of [4, 5, 6]) for (let c = 1; c <= 15; c++) if (/^sarja/i.test(cellText(ws.getCell(r, c)))) found = c
  return found
}

/** Прочитанный Probe. */
export class ProbeBook implements ProbeHeats {
  readonly heats: Map<string, Heat>
  readonly journal: Set<string>
  /** Листы, которые не удалось прочитать. */
  readonly warnings: Message[]

  private constructor(heats: Map<string, Heat>, journal: Set<string>, warnings: Message[]) {
    this.heats = heats
    this.journal = journal
    this.warnings = warnings
  }

  /** Читает Probe. */
  static async read(file: string, options: ProbeSheetsOptions): Promise<ProbeBook> {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(file)
    const heats = new Map<string, Heat>()
    const warnings: Message[] = []
    let order = 0
    const sheetNames = [...options.sheets]
    if (!options.explicit) {
      const cur = wb.getWorksheet(String(options.year))
      const filled = cur && cur.actualRowCount > 8
      if (!filled) sheetNames.push(String(options.year - 1)) // новый год ещё пуст
    }
    for (const name of sheetNames) {
      const ws = wb.getWorksheet(name)
      if (!ws) continue
      const cQty = findColumn(ws, /^cantitatea/i)
      const cSarja = findColumn(ws, /^sarja/i)
      const cProd = findColumn(ws, /^producator/i)
      const cBob = findColumn(ws, /^bobina/i, [6])
      const cBar = findColumn(ws, /^bara/i, [6])
      if (!cQty || !cSarja || !cProd || !cBob || !cBar) {
        warnings.push(message('warn.probeColumns', { sheet: name, detail: `qty=${cQty} sarja=${cSarja} prod=${cProd} bob=${cBob} bar=${cBar}` }))
        continue
      }
      for (let r = 7; r <= ws.rowCount; r++) {
        const sarja = cellText(ws.getCell(r, cSarja))
        if (!sarja) continue
        const qty = toNumber(cellValue(ws.getCell(r, cQty))) ?? 0
        const dBob = toNumber(cellValue(ws.getCell(r, cBob)))
        const dBar = toNumber(cellValue(ws.getCell(r, cBar)))
        const form: HeatForm | null = dBob ? 'Bobina' : dBar ? 'Bara' : null
        if (!form) continue
        const dia = (dBob || dBar)!
        let heat = heats.get(sarja)
        if (!heat) {
          heat = { sarja, producer: cellText(ws.getCell(r, cProd)), dia, form, supplied: 0, rows: [], closed: false, order: order++ }
          heats.set(sarja, heat)
        }
        heat.supplied += qty
        heat.rows.push({ sheet: name, row: r, yellow: hasFill(ws.getCell(r, cSarja), YELLOW) })
      }
    }
    for (const h of heats.values()) h.closed = h.rows.every((x) => x.yellow)
    const journal = new Set<string>()
    const jr = wb.getWorksheet(JOURNAL_SHEET)
    if (jr) {
      for (let r = 2; r <= jr.rowCount; r++) {
        const v = cellText(jr.getCell(r, 2))
        if (v) journal.add(v)
      }
    }
    return new ProbeBook(heats, journal, warnings)
  }

  /**
   * Закрашивает израсходованные плавки жёлтым и снимает жёлтый с плавок, которые программа закрасила сама,
   * а у них снова есть остаток. Каждое действие отмечается в скрытом листе `sync-journal`.
   * @param wb Книга Probe (сохраняет вызывающий).
   * @returns Заметки для журнала.
   */
  paint(wb: ExcelJS.Workbook, toClose: ReadonlySet<string>, toReopen: ReadonlySet<string>, now = new Date()): Message[] {
    const notes: Message[] = []
    let jr = wb.getWorksheet(JOURNAL_SHEET)
    if (!jr) {
      jr = wb.addWorksheet(JOURNAL_SHEET, { state: 'veryHidden' })
      jr.addRow(['время', 'плавка', 'строки'])
    }
    for (const sarja of toClose) {
      const heat = this.heats.get(sarja)!
      for (const x of heat.rows) {
        const ws = wb.getWorksheet(x.sheet)!
        setStyle(ws.getCell(x.row, sarjaColumn(ws)!), { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } } })
      }
      jr.addRow([now.toISOString(), sarja, heat.rows.map((x) => `${x.sheet}!${x.row}`).join(',')])
    }
    for (const sarja of toReopen) {
      for (const x of this.heats.get(sarja)!.rows) {
        const ws = wb.getWorksheet(x.sheet)!
        setStyle(ws.getCell(x.row, sarjaColumn(ws)!), { fill: { type: 'pattern', pattern: 'none' } })
      }
      for (let r = jr.rowCount; r >= 2; r--) if (cellText(jr.getCell(r, 2)) === sarja) jr.spliceRows(r, 1)
      notes.push(message('note.heatReopened', { heat: sarja }))
    }
    return notes
  }
}
