/**
 * Consum (лист «Decont Lunar»): элементы, расход по кодам материала, ID, проекты, месяц и служебная колонка ID.
 *
 *   - колонка ELEMENT — по шапке в строках 7–9 (вставленная оператором колонка сдвигает всё);
 *   - расход — колонки AK…AZ: код в строке 9, Ø в строке 7 (объединение тянется вправо), форма в строке 8;
 *   - проекты — объединённые ячейки колонки A (все строки скрыты — пустой слот, не используется);
 *   - месяц — надпись «LUNA <МЕСЯЦ> <ГОД>» в строках 1–8: «Consum_nov» продолжает «Consum_okt» (см. `Ownership`);
 *   - колонка «ID sync» — по шапке в строках 1–9 (см. `IdColumn`).
 *
 * РИСК: форма — по тексту строки 8: «bob» → Bobina, всё остальное → Bara (опечатка в шапке незаметно меняет форму).
 * РИСК: у формул берётся результат, сохранённый в файле: файл без посчитанных значений даст пустой расход.
 */
import fs from 'node:fs'
import ExcelJS from 'exceljs'
import { message, MessageError, type MessageParam } from '@/shared/messages'
import { cellText, cellValue, columnLetters, decodeRange, solidFill, type MergeRange, type Scalar } from '../Cells'
import { ELEMENT_ID } from './SarjeleBook'

/** Лист Consum с расходом. */
export const CONSUM_SHEET = 'Decont Lunar'

/** Колонка расхода: код материала, Ø, форма. */
export interface NeedColumn {
  c: number
  code: string
  dia: number | null
  form: 'Bobina' | 'Bara'
}

/** Расход элемента по одному коду. */
export interface Need extends NeedColumn {
  kg: number
  exact: number
}

/** Элемент Consum с расходом. */
export interface ConsumItem {
  row: number
  /** Проект, как в Consum. */
  rawProject: string | null
  /** Проект программы (после сопоставления); `null` — строка вне проектов. */
  project: string | null
  name: string
  /** ID из колонки ID или пусто. */
  id: string
  /** Текст в колонке ID, который не похож на ID. */
  badId: string
  /** Количество, штук (колонка справа от ELEMENT). */
  buc: Scalar
  need: Need[]
}

/** Проект из колонки A. */
export interface ConsumProject {
  name: string
  visible: boolean
  /** Строк с расходом. */
  rows: number
}

/** Месяц Consum. */
export interface Period {
  /** «2026-09» или пусто. */
  key: string
  /** «LUNA SEPTEMBRIE 2026» или пусто. */
  label: string
}

/** Как оформить колонку ID (передаётся в `ConsumIdPatcher`). */
export interface IdColumnLook {
  /** Строки таблицы (в колонке B номер) — все в рамке. */
  fillRows: number[]
  /** Объединение шапки: строки `mergeTop`…`mergeBottom`. */
  mergeTop: number
  mergeBottom: number
  /** Строки под шапкой до таблицы — как у образца. */
  below: number[]
  /** Прежние объединения шапки другой высоты — снять. */
  oldMerges: string[]
  /** Колонка-образец (TOTAL/ELEMENT) или 0. */
  donor: number
}

/**
 * Колонка «ID sync». Ищется по шапке («ID sync», потом «ID»); если её нет — создаётся в прежнем месте в конце
 * таблицы. Шапка повторяет шапку «TOTAL/ELEMENT» слева (те же строки объединения и стиль), строки под шапкой до
 * таблицы — как у образца, пустые. Колонка скрыта: служебные данные оператору не нужны.
 * `stale` — оформление не совпадает с нужным: Consum переписывается, даже если новых ID нет.
 */
export interface IdColumn {
  col: number
  /** Шапка найдена (иначе её нужно вписать). */
  hasHeader: boolean
  look: IdColumnLook
  stale: boolean
  /** Параметры строки журнала `tech.idColumn`: где колонка и по какому образцу. */
  describe: Record<string, MessageParam>
}

/** Цвет шапки «ID sync», если образца нет. */
export const ID_HEADER_RED = 'FFE8392B'

/** Названия месяцев (румынские и частые варианты написания). */
const MONTHS: Record<string, number> = {
  IANUARIE: 1, IANUARI: 1, FEBRUARIE: 2, FEBRUARI: 2, MARTIE: 3, APRILIE: 4, APRELIE: 4, MAI: 5, MAY: 5, IUNIE: 6, IULIE: 7,
  AUGUST: 8, SEPTEMBRIE: 9, OCTOMBRIE: 10, NOIEMBRIE: 11, NOEMBRIE: 11, DECEMBRIE: 12,
}

/** Сопоставляет название проекта из Consum с проектом программы. */
export type ProjectResolver = (raw: string) => string | null

/** Прочитанный Consum. */
export class ConsumBook {
  /** Элементы с расходом. */
  readonly items: ConsumItem[]
  /** Все строки с названием элемента (в т.ч. без расхода). */
  readonly allRows: Array<{ rawProject: string | null; name: string; id: string }>
  readonly projects: ConsumProject[]
  readonly idColumn: IdColumn
  readonly period: Period
  /** Время и размер файла при чтении: если изменился до записи ID — ID пишутся в следующий раз. */
  readonly snapshot: { mtimeMs: number; size: number }

  private constructor(data: Pick<ConsumBook, 'items' | 'allRows' | 'projects' | 'idColumn' | 'period' | 'snapshot'>) {
    this.items = data.items
    this.allRows = data.allRows
    this.projects = data.projects
    this.idColumn = data.idColumn
    this.period = data.period
    this.snapshot = data.snapshot
  }

  /**
   * Читает Consum.
   * @throws {MessageError} В книге нет листа «Decont Lunar».
   */
  static async read(file: string, resolveProject: ProjectResolver): Promise<ConsumBook> {
    const st = fs.statSync(file)
    const snapshot = { mtimeMs: st.mtimeMs, size: st.size }
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(file)
    const ws = wb.getWorksheet(CONSUM_SHEET)
    if (!ws) throw new MessageError(message('error.noConsumSheet', { sheet: CONSUM_SHEET }))

    let nameCol = 3
    let seen = false
    for (let r = 7; r <= 9 && !seen; r++) for (let c = 1; c <= 12; c++) if (/^element$/i.test(cellText(ws.getCell(r, c)))) { nameCol = c; seen = true; break }
    const shift = nameCol - 3
    const idColumn = ConsumBook.detectIdColumn(ws, shift)

    const cols: NeedColumn[] = []
    let dia: number | null = null
    for (let c = 37 + shift; c <= 52 + shift; c++) {
      const d = cellText(ws.getCell(7, c))
      if (d) dia = Number(d.replace(/\D/g, ''))
      const code = cellValue(ws.getCell(9, c))
      if (!code) continue
      const f = cellText(ws.getCell(8, c))
      cols.push({ c, code: String(code), dia, form: /bob/i.test(f) ? 'Bobina' : 'Bara' })
    }

    const proj: Array<{ name: string; from: number; to: number; visible: boolean }> = []
    for (const m of ws.model.merges ?? []) {
      const mm = m.match(/^A(\d+):A(\d+)$/)
      if (!mm) continue
      const name = cellText(ws.getCell(Number(mm[1]), 1))
      if (!name) continue
      const from = Number(mm[1])
      const to = Number(mm[2])
      let visible = false
      for (let r = from; r <= to && !visible; r++) visible = !ws.getRow(r).hidden
      proj.push({ name, from, to, visible })
    }
    const rawProjectOf = (r: number) => proj.find((p) => r >= p.from && r <= p.to)?.name ?? null

    const items: ConsumItem[] = []
    const allRows: ConsumBook['allRows'] = []
    for (let r = 10; r <= ws.rowCount; r++) {
      const name = cellText(ws.getCell(r, nameCol))
      if (!name || /^(total|pierderi)/i.test(name)) continue
      const need: Need[] = []
      for (const k of cols) {
        const v = cellValue(ws.getCell(r, k.c))
        if (typeof v === 'number' && Math.round(v) > 0) need.push({ ...k, kg: Math.round(v), exact: v })
      }
      const idText = cellText(ws.getCell(r, idColumn.col))
      const rawProject = rawProjectOf(r)
      allRows.push({ rawProject, name, id: ELEMENT_ID.test(idText) ? idText : '' })
      if (!need.length) continue
      const project = rawProject ? resolveProject(rawProject) ?? rawProject : null
      items.push({
        row: r,
        rawProject,
        project,
        name,
        id: ELEMENT_ID.test(idText) ? idText : '',
        badId: idText && !ELEMENT_ID.test(idText) ? idText : '',
        buc: cellValue(ws.getCell(r, nameCol + 1)),
        need,
      })
    }
    const projects = proj.map((p) => ({ name: p.name, visible: p.visible, rows: items.filter((i) => i.rawProject === p.name).length }))
    return new ConsumBook({ items, allRows, projects, idColumn, period: ConsumBook.readPeriod(ws), snapshot })
  }

  /** Месяц по надписи «LUNA SEPTEMBRIE 2026» (строки 1–8, колонки 1–20). */
  private static readPeriod(ws: ExcelJS.Worksheet): Period {
    for (let r = 1; r <= 8; r++) {
      for (let c = 1; c <= 20; c++) {
        const m = cellText(ws.getCell(r, c)).match(/LUNA\s+([A-Za-z]+)\s+(\d{4})/i)
        const mo = m && MONTHS[m[1]!.toUpperCase()]
        if (mo) return { key: `${m[2]}-${String(mo).padStart(2, '0')}`, label: m[0].toUpperCase() }
      }
    }
    return { key: '', label: '' }
  }

  /** Находит колонку ID и её нужный вид. `shift` — на сколько сдвинуты колонки (оператор вставил свою). */
  private static detectIdColumn(ws: ExcelJS.Worksheet, shift: number): IdColumn {
    const oldIdCol = 126 + shift // прежнее место ID — в конце таблицы
    let col = 0
    let found = false
    for (let c = 1; c <= 140 && !found; c++) for (let r = 1; r <= 9; r++) if (/^id sync$/i.test(cellText(ws.getCell(r, c)))) { found = true; col = c; break }
    for (let c = 1; c <= 140 && !found; c++) for (let r = 1; r <= 9; r++) if (/^id( sync)?$/i.test(cellText(ws.getCell(r, c)))) { found = true; col = c; break }
    if (!found) col = oldIdCol

    const merges: MergeRange[] = (ws.model.merges ?? []).map(decodeRange)
    const mergeAt = (r: number, c: number) => merges.find((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2)
    const fillOf = (r: number, c: number) => solidFill(ws.getCell(r, c))

    // образец — колонка с шапкой «TOTAL/ELEMENT»; нет такой — ближайшая слева видимая колонка с заливкой шапки
    let dc = 0
    let dr = 0
    for (let c = col - 1; c >= Math.max(1, col - 80) && !dc; c--) {
      for (let r = 1; r <= 12; r++) {
        if (/total\s*\/?\s*element/i.test(cellText(ws.getCell(r, c)).replace(/\s+/g, ' '))) { dc = c; dr = r; break }
      }
    }
    for (let d = 1, seen = 0; d <= 80 && !dc && seen < 3; d++) {
      const c = col - d
      if (c < 1) break
      if (ws.getColumn(c).hidden) continue
      seen++
      for (const r of [7, 8, 6, 9]) if (fillOf(r, c)) { dc = c; dr = r; break }
    }
    const own = merges.filter((x) => x.c1 === col && x.c2 === col && x.r1 <= 14)
    let top = 0
    let bottom = 0
    if (dc) {
      const mg = mergeAt(dr, dc)
      if (mg) {
        top = mg.r1
        bottom = mg.r2
      } else {
        // без объединения: подряд залитые строки с текстом или пустые (до итога-числа)
        const headerCell = (r: number) => !!fillOf(r, dc) && typeof cellValue(ws.getCell(r, dc)) !== 'number'
        top = bottom = dr
        while (top > 1 && headerCell(top - 1)) top--
        while (bottom < 14 && headerCell(bottom + 1)) bottom++
      }
    } else {
      top = own[0]?.r1 ?? 6
      bottom = own[0]?.r2 ?? 8
    }
    if (bottom <= top) bottom = top + 1

    // строки таблицы — ниже шапки, где в B номер
    const fillRows: number[] = []
    for (let r = Math.max(10, bottom + 1); r <= ws.rowCount; r++) if (typeof cellValue(ws.getCell(r, 2)) === 'number') fillRows.push(r)
    const headerBottom = Math.max(bottom, (fillRows[0] ?? bottom + 1) - 1)
    const below: number[] = []
    for (let r = bottom + 1; r <= headerBottom; r++) below.push(r)
    const oldMerges = own.filter((x) => x.r1 !== top || x.r2 !== bottom).map((x) => x.ref)
    const needMerge = !own.some((x) => x.r1 === top && x.r2 === bottom)
    const belowBad = below.some((r) => cellText(ws.getCell(r, col)) !== '' || (!!dc && fillOf(r, col) !== fillOf(r, dc)))
    const stale = !ws.getColumn(col).hidden
      || fillRows.some((r) => !ws.getCell(r, col).border?.bottom?.style)
      || fillOf(top, col) !== (dc ? fillOf(top, dc) || ID_HEADER_RED : ID_HEADER_RED)
      || oldMerges.length > 0
      || needMerge
      || belowBad
    const describe = { col: columnLetters(col), donor: dc ? columnLetters(dc) : '—', top, bottom, below: below.length ? message('tech.idColumnBelow', { rows: below.join(',') }) : '' }
    return { col, hasHeader: found, look: { fillRows, mergeTop: top, mergeBottom: bottom, below, oldMerges, donor: dc }, stale, describe }
  }
}
