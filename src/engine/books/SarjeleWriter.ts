/**
 * Запись Sarjele по плану. Шаги — в этом порядке, каждый следующий опирается на предыдущий:
 *
 *   1. Недостающие листы проектов (по образцу самого заполненного листа).
 *   2. Блоки прежнего вида приводятся к итоговому: слева «Model ID» (код), в «Model» — Bara / Bobina.
 *   3. Блоки по плану: дозаполнить пустой, сверить заполненный (кг изменились) или создать новый.
 *   4. ID рядом с заголовками и реестр `sync-registry` (скрытый лист: Формат → Лист → Показать).
 *   5. Оформление итогового вида: Model — жирным цветом формы, «Model ID» и ID — без рамок, текст невидим.
 *   6. Колонки «Model ID» скрываются, где можно (в колонке только наши блоки); где нельзя — показываются.
 *   7. Левая линия таблицы: своя граница Model и правая граница видимой ячейки слева. Excel и другие редакторы
 *      рисуют общую границу по ячейке слева, и если она в скрытой колонке — линии не видно.
 *   8. Зарегистрированные ID — невидимым форматом.
 *
 * РИСК: вид таблицы зависит от того, кому «принадлежит» общая граница со скрытой колонкой; после правок
 * шагов 5–7 проверять настоящий Sarjele глазами.
 * РИСК: «запасным» листом для нового проекта считается любой пустой скрытый лист или лист с именем вроде «1»,
 * «new», «шаблон». Пустой скрытый лист, нужный для другого, будет переименован и показан.
 */
import type ExcelJS from 'exceljs'
import { message, MessageError, type Message } from '@/shared/messages'
import { safeSheetName } from '@/shared/names'
import { cellText, cellValue, copyStyle, emptyAt, hasBorder, setStyle, todayLabel, toNumber, type Scalar } from '../Cells'
import type { Ownership } from '../planning/ElementLinker'
import { isRealLine, type PlanAction, type PlanItem, type PlanLine } from '../planning/Planner'
import type { ProjectCatalog } from '../planning/ProjectCatalog'
import type { ProbeHeats } from './ProbeBook'
import { blockRows, classifyBlock, HIDDEN_FORMAT, isFormWord, isModelHeaderAt, modelIdColumnOnly, REGISTRY_SHEET } from './SarjeleBook'

/** Цвета формы в колонке Model. */
const FORM_COLOR = { Bobina: 'FFC0392B', Bara: 'FF2F75B5' } as const

/** Линия по умолчанию, если у KG нет правой границы. */
const THIN: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FF000000' } }

/** Имена запасных листов. */
const SPARE_NAME = /^(\d+|new|new sheet|template|free|spare|шаблон|новый|свободн\S*|пуст\S*|rezerva|liber)$/i

/** Глубокая копия. */
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o ?? {})) as T

/** Форма — подпись Bara / Bobina или пусто. */
const isFormLabel = (x: string) => x === '' || isFormWord(x)

/** Плавка как число, если это число (в Sarjele плавки пишутся числами, где можно). */
const sarjaValue = (s: string | number): string | number => (isNaN(Number(s)) ? s : Number(s))

/** Образец оформления блока: заголовок, шапка, строка данных. */
interface SampleBlock {
  col: number
  titleRow: number
  headerRow: number
  dataRow: number
  /** Лист, откуда брать оформление (у нового листа — лист-образец). */
  ws: ExcelJS.Worksheet
}

/** Раскладка листа: где стоят блоки, с какого брать оформление и куда ставить новый. */
interface SheetLayout {
  blocks: Array<{ col: number; headerRow: number; rows: number }>
  sample: SampleBlock | null
  /** Где ставить первый блок (новый лист проекта). */
  place?: { col: number; titleRow: number }
  /** Лист только что создан: первый блок — на месте образца. */
  fresh?: boolean
}

/** Где стоит записанный блок: строка заголовка и колонка Model. */
export interface BlockAnchor {
  titleRow: number
  col: number
}

/** Что нужно для записи Sarjele. */
export interface SarjeleWriteInput {
  plan: PlanItem[]
  /** Действия с ID (привязка, новые блоки, переименования). */
  acts: PlanAction[]
  /** ID, которые нужно вписать в Consum: строка Consum → ID (уточняется здесь). */
  consumIds: Map<number, string>
  catalog: ProjectCatalog
  ownership: Ownership
  /** Имя текущего Consum. */
  source: string
  /** Месяц Consum. */
  periodKey: string
  now?: Date
}

/** Итог записи Sarjele. */
export interface SarjeleWriteResult {
  warnings: Message[]
  notes: Message[]
  /** ID, поставленные у заголовков блоков (для проверки после записи). */
  placedIds: string[]
}

/** Записывает план в книгу Sarjele (сохраняет вызывающий). */
export class SarjeleWriter {
  private readonly wb: ExcelJS.Workbook
  private readonly probe: ProbeHeats
  /** Раскладки листов книги: считаются при первом обращении к листу. */
  private readonly layouts = new Map<ExcelJS.Worksheet, SheetLayout>()
  private readonly warnings: Message[] = []
  private readonly notes: Message[] = []

  constructor(wb: ExcelJS.Workbook, probe: ProbeHeats) {
    this.wb = wb
    this.probe = probe
  }

  /** Вносит план в книгу. */
  apply(input: SarjeleWriteInput): SarjeleWriteResult {
    const { plan, acts, catalog } = input
    const sheetNames = new Set([...plan.map((p) => p.sheet), ...acts.map((a) => catalog.sheetOf(a.it.project!)), ...catalog.missingSheets()].filter((x): x is string => !!x))
    for (const name of sheetNames) {
      if (this.wb.getWorksheet(name)) continue
      try {
        this.createProjectSheet(name)
        this.notes.push(message('note.sheetCreated', { sheet: name }))
      } catch (e) {
        this.warnings.push(message('warn.sheetNotCreated', { sheet: name, reason: e instanceof MessageError ? e.msg : message('error.other', { error: (e as Error).message }) }))
      }
    }
    this.migrateLayouts()
    for (const p of plan) {
      const ws = this.wb.getWorksheet(p.sheet ?? '')
      if (!ws) {
        this.warnings.push(message('warn.sheetMissing', { element: p.element, sheet: p.sheet ?? '' }))
        continue
      }
      this.layout(ws)
      p.anchor = this.writeBlock(ws, p)
    }
    const rg = this.registrySheet()
    const placedIds = this.writeIds(input, rg)
    this.decorate()
    this.hideModelIdColumns()
    this.drawLeftEdgesAndHideIds(rg)
    return { warnings: this.warnings, notes: this.notes, placedIds }
  }

  /** Создаёт листы проектов (`--create-sheets`). */
  createSheets(names: readonly string[], onCreated: (name: string) => void): void {
    for (const name of names) {
      this.createProjectSheet(name)
      onCreated(name)
    }
  }

  // ── Раскладка и листы проектов ────────────────────────────────────────────

  /** Раскладка листа: находит блоки и образец при первом обращении. */
  private layout(ws: ExcelJS.Worksheet): SheetLayout {
    let layout = this.layouts.get(ws)
    if (layout) return layout
    layout = { blocks: [], sample: null }
    const found = layout
    ws.eachRow((row, r) => row.eachCell((cell, k) => {
      const v = cellValue(cell)
      if ((v === 'Model' || v === 'Model ID') && cellText(ws.getCell(r, k + 4)) === 'KG') {
        let n = 0
        while (!emptyAt(ws, r + 1 + n, k, 5)) n++
        found.blocks.push({ col: k, headerRow: r, rows: n })
        found.sample ??= { col: k, titleRow: r - 1, headerRow: r, dataRow: r + 1, ws }
      }
    }))
    this.layouts.set(ws, layout)
    return layout
  }

  /**
   * Лист проекта по образцу самого заполненного. Сначала берётся готовый пустой лист-«запас» (в файле их
   * заранее наделано: «1»…«5», обычно скрытые): переименовывается и показывается. Если запаса нет — добавляется
   * новый лист с ширинами колонок, высотами строк и цветом ярлыка образца.
   * @throws {MessageError} Имя недопустимо для Excel или в Sarjele нет ни одного блока-образца.
   */
  private createProjectSheet(name: string): ExcelJS.Worksheet {
    const real = safeSheetName(name)
    if (real !== name) throw new MessageError(message('sheet.badName', { name, safe: real }))
    const existing = this.wb.getWorksheet(name)
    if (existing) return existing
    let tpl: ExcelJS.Worksheet | null = null
    for (const w of this.wb.worksheets) {
      if (w.state && w.state !== 'visible') continue
      const layout = this.layout(w)
      if (layout.sample && (!tpl || layout.blocks.length > this.layout(tpl).blocks.length)) tpl = w
    }
    if (!tpl) throw new MessageError(message('sheet.noSample'))
    const sb = this.layout(tpl).sample!
    const spare = this.findSpareSheet(tpl)
    if (spare) {
      spare.name = name
      spare.state = 'visible'
      if (tpl.properties?.tabColor && !spare.properties?.tabColor) spare.properties.tabColor = tpl.properties.tabColor
      // как на листах проектов: первый блок в C2
      this.layouts.set(spare, { blocks: [], sample: { ...sb, ws: tpl }, place: { col: 3, titleRow: 2 }, fresh: true })
      return spare
    }
    const ws = this.wb.addWorksheet(name, { views: JSON.parse(JSON.stringify(tpl.views ?? [])) })
    for (let i = 0; i < 6; i++) {
      const w = tpl.getColumn(sb.col + i).width
      if (w) ws.getColumn(sb.col + i).width = w
    }
    for (const r of [sb.titleRow, sb.headerRow, sb.dataRow]) {
      const h = tpl.getRow(r).height
      if (h) ws.getRow(r).height = h
    }
    if (tpl.properties?.tabColor) ws.properties.tabColor = tpl.properties.tabColor
    this.layouts.set(ws, { blocks: [], sample: { ...sb, ws: tpl }, fresh: true })
    return ws
  }

  /** Пустой лист без единого значения: скрытый либо с «запасным» именем. */
  private findSpareSheet(exclude: ExcelJS.Worksheet): ExcelJS.Worksheet | null {
    for (const w of this.wb.worksheets) {
      if (w === exclude || w.name === REGISTRY_SHEET) continue
      let used = false
      w.eachRow((row) => row.eachCell((c) => {
        if (cellValue(c) != null && cellText(c) !== '') used = true
      }))
      if (used) continue
      if ((w.state && w.state !== 'visible') || SPARE_NAME.test(w.name.trim())) return w
    }
    return null
  }

  /** Шаг 2: блоки прежнего вида → итоговый вид. */
  private migrateLayouts(): void {
    for (const ws of this.wb.worksheets) {
      if (ws.name === REGISTRY_SHEET) continue
      const found: Array<[number, number, unknown]> = []
      ws.eachRow((row, r) => row.eachCell((cell, c) => {
        const hv = cellValue(cell)
        if (c >= 2 && (hv === 'Model' || hv === 'Model ID') && cellText(ws.getCell(r, c + 1)) === 'ø' && cellText(ws.getCell(r, c + 4)) === 'KG') found.push([r, c, hv])
      }))
      for (const [r, c, hv] of found) {
        const cls = classifyBlock(ws, r, c, hv)
        if (cls.state !== 'transitional' && cls.state !== 'migrate') continue // уже итоговый вид, либо слева занято чужим
        const transitional = cls.state === 'transitional'
        for (const rr of cls.dataRows) {
          const here = ws.getCell(rr, c)
          const left = ws.getCell(rr, c - 1)
          const pf = this.probe.heats.get(cellText(ws.getCell(rr, c + 2)))?.form ?? ''
          if (transitional) {
            const code = here.value
            const lab = cellText(left)
            left.value = code
            here.value = lab || pf || null
          } else if (cls.formAtC) left.value = null // старый вид без кодов: форма уже в колонке Model
          else {
            left.value = here.value // самый старый вид: код был в колонке Model
            here.value = pf || null
          }
        }
        ws.getCell(r, c - 1).value = 'Model ID'
        ws.getCell(r, c).value = 'Model'
      }
    }
  }

  // ── Шаг 3: блоки ──────────────────────────────────────────────────────────

  /** Записывает блок по плану. @returns Где стоит блок, или `null`, если места нет. */
  private writeBlock(ws: ExcelJS.Worksheet, p: PlanItem, today = todayLabel()): BlockAnchor | null {
    if (p.recon) {
      this.writeRecon(ws, p)
      return { titleRow: p.block!.titleRow, col: p.block!.col }
    }
    const lines = p.lines.filter(isRealLine)
    if (p.block) return this.fillBlock(ws, p, lines)
    return this.createBlock(ws, p, lines, today)
  }

  /**
   * Сверяет заполненный блок с Consum: к строкам блока добавляются/снимаются кг, строки с нулём убираются,
   * новые ставятся после последней строки того же кода.
   */
  private writeRecon(ws: ExcelJS.Worksheet, p: PlanItem): void {
    const b = p.block!
    const cc = !b.plain ? b.col - 1 : b.col // код — в колонке слева (Model ID), форма — в Model
    const fc = !b.plain ? b.col : 0
    type Row = { r?: number; model: Scalar; form: string; dia: unknown; sarja: unknown; name: unknown; kg: number }
    const rows: Row[] = []
    for (let r = b.headerRow + 1; !emptyAt(ws, r, b.col, 5); r++) {
      const v = [1, 2, 3, 4].map((i) => ws.getCell(r, b.col + i).value)
      rows.push({ r, model: ws.getCell(r, cc).value as Scalar, form: fc ? cellText(ws.getCell(r, fc)) : '', dia: v[0], sarja: v[1], name: v[2], kg: toNumber(cellValue(ws.getCell(r, b.col + 4))) ?? 0 })
    }
    const oldN = rows.length
    for (const c of p.recon!.cuts) {
      const x = rows.find((q) => q.r === c.row.r)
      if (x) x.kg -= c.take
    }
    for (const a of p.recon!.adds.filter(isRealLine)) {
      const same = rows.find((q) => String(q.model) === String(a.model) && String(q.sarja) === String(a.sarja))
      if (same) same.kg += a.kg
      else {
        const idx = rows.map((q) => String(q.model)).lastIndexOf(String(a.model))
        rows.splice(idx < 0 ? rows.length : idx + 1, 0, { model: Number(a.model) || a.model, form: a.form, dia: a.dia, sarja: sarjaValue(a.sarja), name: a.name, kg: a.kg })
      }
    }
    const out = rows.filter((q) => q.kg > 0)
    // новые строки + зазор в одну строку должны быть пусты
    for (let i = oldN; i <= out.length; i++) {
      if (i >= oldN && out.length > oldN && !emptyAt(ws, b.headerRow + 1 + i, b.col, 5)) {
        this.warnings.push(message('warn.noRoomRows', { element: p.element }))
        return
      }
    }
    out.forEach((q, i) => {
      const r = b.headerRow + 1 + i
      if (r > b.headerRow + oldN) for (let k = cc - b.col; k < 5; k++) copyStyle(ws.getCell(r - 1, b.col + k), ws.getCell(r, b.col + k))
      ws.getCell(r, cc).value = q.model as ExcelJS.CellValue
      if (fc) ws.getCell(r, fc).value = q.form || null
      ;[q.dia, q.sarja, q.name, q.kg].forEach((v, k) => (ws.getCell(r, b.col + 1 + k).value = v as ExcelJS.CellValue))
    })
    for (let i = out.length; i < oldN; i++) for (let k = cc - b.col; k < 5; k++) ws.getCell(b.headerRow + 1 + i, b.col + k).value = null
  }

  /**
   * Дозаполняет пустой блок: строки плана ложатся в пустые строки блока с тем же кодом и Ø; если расход разбит
   * на несколько плавок — добавляются строки под блоком (только если там свободно).
   */
  private fillBlock(ws: ExcelJS.Worksheet, p: PlanItem, lines: PlanLine[]): BlockAnchor {
    const b = p.block!
    let end = b.headerRow + b.rows.length // последняя занятая строка блока
    for (const l of lines) {
      const row = b.rows.find((x) => String(x.model) === String(l.model) && toNumber(x.dia) === l.dia && !x.sarja && !x.used)
      let r = row?.r
      if (row) row.used = true
      else {
        // доп. строка (расход разбит на две плавки) — только если место свободно
        r = ++end
        if (!emptyAt(ws, r, b.col, 5)) {
          this.warnings.push(message('warn.noRoomRow', { element: p.element, heat: l.sarja }))
          continue
        }
        for (let i = b.plain ? 0 : -1; i < 5; i++) copyStyle(ws.getCell(end - 1, b.col + i), ws.getCell(r, b.col + i))
        ws.getCell(r, b.plain ? b.col : b.col - 1).value = l.model as ExcelJS.CellValue
        ws.getCell(r, b.col + 1).value = l.dia
      }
      if (!b.plain) ws.getCell(r!, b.col).value = l.form ?? null // Model: Bara / Bobina
      ws.getCell(r!, b.col + 2).value = sarjaValue(l.sarja)
      ws.getCell(r!, b.col + 3).value = l.name
      ws.getCell(r!, b.col + 4).value = l.kg
      if (!ws.getCell(r!, b.col + 2).style.border) copyStyle(ws.getCell(b.headerRow + 1, b.col + 2), ws.getCell(r!, b.col + 2))
    }
    return { titleRow: b.titleRow, col: b.col }
  }

  /** Новый блок: в колонке с самым нижним блоком листа, через 3 строки под ним; оформление — с образца. */
  private createBlock(ws: ExcelJS.Worksheet, p: PlanItem, lines: PlanLine[], today: string): BlockAnchor | null {
    const layout = this.layout(ws)
    const sample = layout.sample!
    const sw = sample.ws ?? ws // откуда копируем оформление (у нового листа — лист-образец)
    const mine = layout.blocks
    const col = layout.place?.col ?? sample.col
    let bottom = 0
    for (const b of mine) if (b.col === col) bottom = Math.max(bottom, b.headerRow + b.rows)
    const t = layout.fresh && !mine.some((b) => b.col === col) ? (layout.place?.titleRow ?? sample.titleRow) : bottom + 4
    const h = t + 1
    const lc = col > 1 ? col - 1 : col // колонка кода (Model ID) — слева от блока
    if (!emptyAt(ws, t, lc, 7)) {
      this.warnings.push(message('warn.noRoomBlock', { element: p.element }))
      return null
    }
    const lo = col > 1 && sample.col > 1 ? -1 : 0
    for (let i = lo; i < 5; i++) {
      copyStyle(sw.getCell(sample.titleRow, sample.col + i), ws.getCell(t, col + i))
      copyStyle(sw.getCell(sample.headerRow, sample.col + i), ws.getCell(h, col + i))
    }
    ;(col > 1 ? ['Model ID', 'Model', 'ø', 'Sarje', 'Name', 'KG'] : ['Model', 'ø', 'Sarje', 'Name', 'KG']).forEach((x, i) => (ws.getCell(h, lc + i).value = x))
    ws.mergeCells(t, col, t, col + 3)
    ws.getCell(t, col).value = p.element
    ws.getCell(t, col + 4).value = today
    lines.forEach((l, k) => {
      const r = h + 1 + k
      for (let i = lo; i < 5; i++) copyStyle(sw.getCell(sample.dataRow, sample.col + i), ws.getCell(r, col + i))
      ws.getCell(r, lc).value = (Number(l.model) || l.model) as ExcelJS.CellValue
      if (col > 1) ws.getCell(r, col).value = l.form ?? null
      ws.getCell(r, col + 1).value = l.dia
      ws.getCell(r, col + 2).value = sarjaValue(l.sarja)
      ws.getCell(r, col + 3).value = l.name
      ws.getCell(r, col + 4).value = l.kg
    })
    mine.push({ col, headerRow: h, rows: lines.length })
    return { titleRow: t, col }
  }

  // ── Шаг 4: ID и реестр ────────────────────────────────────────────────────

  /** Лист реестра: показываемый через «Показать…», со всеми колонками шапки. */
  private registrySheet(): ExcelJS.Worksheet {
    let rg = this.wb.getWorksheet(REGISTRY_SHEET)
    if (rg && rg.state === 'veryHidden') rg.state = 'hidden'
    if (!rg) {
      rg = this.wb.addWorksheet(REGISTRY_SHEET, { state: 'hidden' })
      rg.addRow(['id', 'проект', 'название в Consum', 'лист Sarjele', 'расход Consum (код → кг)', 'обновлено', 'источник Consum'])
    }
    if (!cellText(rg.getCell(1, 7))) rg.getCell(1, 7).value = 'источник Consum'
    if (!cellText(rg.getCell(1, 8))) rg.getCell(1, 8).value = 'период Consum'
    return rg
  }

  /** ID у заголовков и записи реестра. @returns Поставленные ID. */
  private writeIds(input: SarjeleWriteInput, rg: ExcelJS.Worksheet): string[] {
    const { acts, consumIds, catalog, ownership, source, periodKey } = input
    const now = input.now ?? new Date()
    const placed: string[] = []
    for (const a of acts) {
      const anchor = a.p?.anchor ?? ('block' in a.res ? { titleRow: a.res.block.titleRow, col: a.res.block.col } : null)
      if (!anchor) {
        consumIds.delete(a.it.row)
        continue
      }
      const ws = this.wb.getWorksheet(catalog.sheetOf(a.it.project!) ?? '')
      if (!ws) {
        consumIds.delete(a.it.row)
        continue
      }
      const idc = anchor.col > 1 ? anchor.col - 1 : anchor.col + 5 // ID — слева от названия элемента
      const idCell = ws.getCell(anchor.titleRow, idc)
      if (anchor.col > 1) {
        // переезд со старого места
        const old = ws.getCell(anchor.titleRow, anchor.col + 5)
        if (cellText(old) === a.res.id) old.value = null
      }
      const cur = cellText(idCell)
      if (cur && cur !== a.res.id) {
        this.warnings.push(message('warn.idCellBusy', { element: a.it.name, value: cur }))
        consumIds.delete(a.it.row)
        continue
      }
      if (!cur) idCell.value = a.res.id
      setStyle(idCell, { numFmt: HIDDEN_FORMAT })
      placed.push(a.res.id)
      if ('rename' in a.res && a.res.rename) {
        ws.getCell(anchor.titleRow, anchor.col).value = a.it.name
        this.notes.push(message('note.renamed', { id: a.res.id, name: a.it.name }))
      }
      const vals = [a.res.id, a.it.project, a.it.name, ws.name, JSON.stringify(Object.fromEntries(a.it.need.map((n) => [n.code, n.kg]))), now.toISOString()]
      let row: number | null = null
      for (let r = 2; r <= rg.rowCount; r++) if (cellText(rg.getCell(r, 1)) === a.res.id) row = r
      const target = row ?? rg.rowCount + 1
      vals.forEach((v, k) => (rg.getCell(target, k + 1).value = v))
      const cs = cellText(rg.getCell(target, 7))
      const cp = cellText(rg.getCell(target, 8))
      if (periodKey) rg.getCell(target, 8).value = periodKey
      if (!cs) rg.getCell(target, 7).value = source
      else if (cs !== source && ownership.mine(cs, cp)) {
        rg.getCell(target, 7).value = source
        this.notes.push(message('note.idMoved', { id: a.res.id, from: cs, to: source }))
      }
      if (a.res.kind === 'migrate') this.notes.push(message('note.linked', { id: a.res.id, title: a.res.block.title }))
      if (a.res.kind === 'new') this.notes.push(message('note.blockCreated', { id: a.res.id, name: a.it.name }))
    }
    return placed
  }

  // ── Шаги 5–8: оформление ──────────────────────────────────────────────────

  /** Линия таблицы блока — как правая граница шапки KG. */
  private static tableEdge(ws: ExcelJS.Worksheet, headerRow: number, col: number): Partial<ExcelJS.Border> {
    return clone(ws.getCell(headerRow, col + 4).border?.right ?? THIN)
  }

  /** Шаг 5: оформление блоков итогового вида. */
  private decorate(): void {
    for (const ws of this.wb.worksheets) {
      if (ws.name === REGISTRY_SHEET) continue
      ws.eachRow((_row, r) => _row.eachCell((cell, c) => {
        if (c < 2 || cellValue(cell) !== 'Model' || cellText(ws.getCell(r, c - 1)) !== 'Model ID' || cellText(ws.getCell(r, c + 1)) !== 'ø' || cellText(ws.getCell(r, c + 4)) !== 'KG') return
        const lw = ws.getColumn(c - 1)
        if (!lw.width || lw.width < 11) lw.width = 11
        const mw = ws.getColumn(c)
        if (!mw.width || mw.width < 11) mw.width = 11
        const idc = ws.getCell(r - 1, c - 1)
        const t = ws.getCell(r - 1, c)
        copyStyle(t, idc)
        setStyle(idc, { font: { ...clone(t.font), size: 10 }, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: HIDDEN_FORMAT })
        copyStyle(cell, ws.getCell(r, c - 1))
        setStyle(ws.getCell(r, c - 1), { numFmt: HIDDEN_FORMAT })
        for (let rr = r + 1; !emptyAt(ws, rr, c, 5); rr++) {
          const codeC = ws.getCell(rr, c - 1)
          const formC = ws.getCell(rr, c)
          const nameC = ws.getCell(rr, c + 3)
          const heat = this.probe.heats.get(cellText(ws.getCell(rr, c + 2)))
          const cur = cellText(formC)
          if (heat && cur !== heat.form && isFormLabel(cur)) formC.value = heat.form
          const form = /^bobina$/i.test(cellText(formC)) ? 'Bobina' : /^bara$/i.test(cellText(formC)) ? 'Bara' : null
          copyStyle(ws.getCell(rr, c + 1), codeC)
          setStyle(codeC, { font: { name: clone(nameC.font).name, size: 9, color: { argb: 'FF0000FF' } }, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: HIDDEN_FORMAT })
          copyStyle(nameC, formC)
          setStyle(formC, { font: { ...clone(nameC.font), bold: true, ...(form ? { color: { argb: FORM_COLOR[form] } } : {}) }, alignment: { horizontal: 'center', vertical: 'middle' } })
        }
        // «Model ID» скрыт — левая граница таблицы теперь у колонки Model
        const lb = SarjeleWriter.tableEdge(ws, r, c)
        for (const rr of blockRows(ws, r, c)) {
          const x = ws.getCell(rr, c)
          setStyle(x, { border: { ...clone(x.border), left: lb } })
        }
        // «Model ID», коды и ID — без рамки и заливки, текст невидим: рамка скрытой ячейки «забирает» общую границу
        idc.style = { numFmt: HIDDEN_FORMAT } as ExcelJS.Style
        ws.getCell(r, c - 1).style = { numFmt: HIDDEN_FORMAT } as ExcelJS.Style
        for (let rr = r + 1; !emptyAt(ws, rr, c, 5); rr++) ws.getCell(rr, c - 1).style = { numFmt: HIDDEN_FORMAT } as ExcelJS.Style
      }))
    }
  }

  /** Шаг 6: скрыть или показать колонки «Model ID». */
  private hideModelIdColumns(): void {
    for (const ws of this.wb.worksheets) {
      if (ws.name === REGISTRY_SHEET) continue
      const blanked = new Set<number>()
      ws.eachRow((row, r) => row.eachCell((_cell, c) => {
        if (!isModelHeaderAt(ws, r, c)) return
        const leftIsModelId = c > 1 && cellText(ws.getCell(r, c - 1)) === 'Model ID'
        if (c === 2 && cellText(ws.getCell(r, 1)) === 'Model ID') {
          // первую колонку не скрываем (слева нет ячейки для линии) — делаем узкой
          const a = ws.getColumn(1)
          if (a.hidden) a.hidden = false
          if (modelIdColumnOnly(ws, 1) && a.width !== 2) a.width = 2
        } else if (leftIsModelId && !ws.getColumn(c - 1).hidden && modelIdColumnOnly(ws, c - 1)) ws.getColumn(c - 1).hidden = true
        else if (leftIsModelId && ws.getColumn(c - 1).hidden && !modelIdColumnOnly(ws, c - 1)) ws.getColumn(c - 1).hidden = false // скрывать нельзя — показываем (ячейки пустые на вид)
        if (c > 1 && ws.getColumn(c - 1).hidden && cellText(ws.getCell(r, c - 1)) === 'Model ID' && !blanked.has(c - 1)) {
          // вся скрытая колонка — без рамок: иначе Excel не рисует соседнюю линию
          blanked.add(c - 1)
          for (let rr = 1; rr <= ws.rowCount; rr++) {
            const x = ws.getCell(rr, c - 1)
            if (x.border && Object.keys(x.border).length) x.style = { numFmt: HIDDEN_FORMAT } as ExcelJS.Style
          }
        }
      }))
    }
  }

  /** Шаги 7–8: левая линия и невидимые ID. */
  private drawLeftEdgesAndHideIds(rg: ExcelJS.Worksheet): void {
    const regIds = new Set<string>()
    for (let r = 2; r <= rg.rowCount; r++) {
      const id = cellText(rg.getCell(r, 1))
      if (id) regIds.add(id)
    }
    for (const ws of this.wb.worksheets) {
      if (ws.name === REGISTRY_SHEET) continue
      ws.eachRow((_row, r) => _row.eachCell((cell, c) => {
        if (cellValue(cell) !== 'Model' || cellText(ws.getCell(r, c + 1)) !== 'ø' || cellText(ws.getCell(r, c + 4)) !== 'KG' || r < 2) return
        // левая граница таблицы — у колонки Model, у любого блока (слева может быть скрытая или пустая колонка)
        const lb = SarjeleWriter.tableEdge(ws, r, c)
        for (const rr of blockRows(ws, r, c)) {
          const x = ws.getCell(rr, c)
          if (!hasBorder(x, 'left')) setStyle(x, { border: { ...clone(x.border ?? {}), left: lb } })
        }
        // колонка слева скрыта: линию даёт правая граница ближайшей видимой ячейки слева
        let vc = c - 1
        while (vc >= 1 && ws.getColumn(vc).hidden) vc--
        if (vc >= 1 && vc < c - 1) {
          for (const rr of blockRows(ws, r, c)) {
            const x = ws.getCell(rr, vc)
            if (!hasBorder(x, 'right')) setStyle(x, { border: { ...clone(x.border ?? {}), right: lb } })
          }
        }
        for (const ic of [c - 1, c + 5]) {
          if (ic < 1) continue
          const x = ws.getCell(r - 1, ic)
          if (regIds.has(cellText(x)) && x.numFmt !== HIDDEN_FORMAT) setStyle(x, { numFmt: HIDDEN_FORMAT })
        }
      }))
    }
  }
}
