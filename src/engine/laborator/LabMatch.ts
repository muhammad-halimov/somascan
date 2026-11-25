/**
 * Запись таблицы лаборатории для рапорта Betsy: строка элемента рапорта с результатом «Rc decofr.».
 *
 * Строка подходит, если:
 *   - элемент тот же: «COD ELEMENT» рапорта («PO08-TIP1») — это «Simbol Element Prefabricat» строки («TIP 1»),
 *     перед ним — конец «Denum elem. pref.» («PREDALE POD PO 08»); пробелы, дефисы и точки не в счёт;
 *   - «Rc decofr.», «Nr.bul.» и «Data» заполнены (прочность — число, дата — дата); пустые строки пропускаются;
 *   - «Data» результата — не позже «TURNAT LA» рапорта и не раньше, чем за `DATE_WINDOW_DAYS` рабочих дня до него
 *     (выходные не в счёт, `shared/workdays`): тот же элемент бетонируют почти каждый день, старые строки не подходят.
 *     «Data turn. elem.» не используется.
 *
 * Из подходящих лучшая — с серией рапорта в «Seria elem Prefabricat» («92/8752-P-1-628÷650» — серии 628…650),
 * затем с номером проекта рапорта в начале серии, затем с более поздней «Data», затем нижняя.
 *
 * РИСК: другой символ элемента в таблице и в рапорте (опечатка, «TIP1» против «TIP 2») — строка не находится,
 * в журнале — что искали.
 */
import { cleanText } from '@/shared/names'
import { workdaysBefore, workdaysBetween } from '@/shared/workdays'
import { cellValue, columnLetters, type Scalar } from '../Cells'
import { ELEMENT_HEADERS, type ElementColumns } from './LabHeader'
import { calendarDate, dateLabel, type LabLayout } from './LaboratorBook'

/** За сколько рабочих дней (выходные не в счёт) до «TURNAT LA» рапорта может быть «Data» результата. */
export const DATE_WINDOW_DAYS = 3

/** Что ищется: элемент рапорта Betsy («COD ELEMENT», «Serie», «PROIECT NR») и «TURNAT LA». */
export interface LabQuery {
  code: string
  serie: string
  project: string
  /** «TURNAT LA» (полночь UTC). */
  date: Date
}

/** Подходящая строка таблицы лаборатории. */
export interface LabMatch {
  row: number
  /** Ячейка «Rc decofr.»: «H3643». */
  cell: string
  value: number
  bulletin: string
  /** «Data» результата. */
  date: Date
  /** Сколько рабочих дней от «Data» до «TURNAT LA» рапорта (0…`DATE_WINDOW_DAYS`). */
  days: number
  /** Серия рапорта есть в «Seria elem Prefabricat». */
  serie: boolean
  /** Номер проекта рапорта — в начале «Seria elem Prefabricat». */
  project: boolean
}

/** Ключ элемента: заглавные, без пробелов, дефисов, точек и подчёркиваний («PO 08» → «PO08»). */
const key = (text: string) => text.toUpperCase().replace(/[\s\-_.]+/g, '')

/**
 * Элемент рапорта ли это: «COD ELEMENT» = конец названия + символ («PO08-TIP1» = «…PO 08» + «TIP 1») или сам символ.
 */
export function sameElement(code: string, name: string, symbol: string): boolean {
  const want = key(code)
  const sym = key(symbol)
  if (!want || !sym || !want.endsWith(sym)) return false
  const rest = want.slice(0, want.length - sym.length)
  return !rest || key(name).endsWith(rest)
}

/**
 * Есть ли серия в «Seria elem Prefabricat»: серии — после последнего дефиса, через «;» или «,», диапазон —
 * через «÷» («628÷650»). Серия рапорта — число или несколько через «;», «,».
 */
export function seriesContains(series: string, serie: string): boolean {
  const wanted = serie.split(/[;,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0)
  if (!wanted.length) return false
  const tail = series.slice(series.lastIndexOf('-') + 1)
  const ranges = tail.split(/[;,]/).flatMap((part) => {
    const m = /^\s*(\d+)\s*(?:÷\s*(\d+))?\s*$/.exec(part)
    return m ? [[Number(m[1]), Number(m[2] ?? m[1])] as const] : []
  })
  return wanted.some((n) => ranges.some(([from, to]) => n >= from && n <= to))
}

/** Номер проекта рапорта в начале серии: «92/8752-P-1-…» и «92/8752». */
export function sameProject(series: string, project: string): boolean {
  const want = project.replace(/\s+/g, '')
  const have = series.replace(/\s+/g, '')
  return !!want && have.startsWith(want) && (have.length === want.length || have[want.length] === '-')
}

/** Дата из ячейки: дата Excel или текст «02.11.2026»; иначе `null`. */
function dateOf(value: Scalar): Date | null {
  if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  const m = /^\s*(\d{1,2})[./](\d{1,2})[./](\d{4})\s*$/.exec(String(value ?? ''))
  return m ? calendarDate(m[1]!, m[2]!, m[3]!) : null
}

/** Прочность из ячейки: число или текст-число («33,3»); иначе `null` (неразделённая ячейка, текст). */
function numberOf(value: Scalar): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*$/.exec(String(value ?? ''))
  return m ? Number(m[1]!.replace(',', '.')) : null
}

/** Текст ячейки без лишних пробелов. */
const textOf = (value: Scalar) => (value instanceof Date ? dateLabel(value) : cleanText(value))

/** Колонки элемента, которых нет в шапке (названия для журнала). */
export const missingColumns = (layout: LabLayout): string[] =>
  (Object.keys(ELEMENT_HEADERS) as Array<keyof ElementColumns>).filter((k) => !layout.element[k]).map((k) => ELEMENT_HEADERS[k].title)

/** Прочность для рапорта: как в таблице (формат «0.0»): 34 → «34.0», 33.25 → «33.25». */
export const valueLabel = (value: number): string => (Number.isInteger(value * 10) ? value.toFixed(1) : String(value))

/**
 * Подходящие строки — лучшая первой (см. описание модуля).
 * @param layout Таблица разделена, колонки элемента есть (`missingColumns` пуст).
 */
export function findLabMatches(layout: LabLayout, query: LabQuery): LabMatch[] {
  const { sheet, header, decofr } = layout
  const col = layout.element
  if (!query.code) return []
  // окно «Data»: от начала (за `DATE_WINDOW_DAYS` рабочих дней) по «TURNAT LA»; позже — не подходит, даже через выходные
  const [from, to] = [workdaysBefore(query.date, DATE_WINDOW_DAYS).getTime(), query.date.getTime()]
  const at = (row: number, column: number): Scalar => (column ? cellValue(sheet.getCell(row, column)) : null)
  const out: LabMatch[] = []
  for (let row = header + 1; row <= sheet.rowCount; row++) {
    if (!sameElement(query.code, textOf(at(row, col.name)), textOf(at(row, col.symbol)))) continue
    const value = numberOf(at(row, decofr))
    const bulletin = textOf(at(row, decofr + 1))
    const date = dateOf(at(row, decofr + 2))
    if (value === null || !bulletin || !date || date.getTime() < from || date.getTime() > to) continue
    const series = textOf(at(row, col.series))
    out.push({ row, cell: `${columnLetters(decofr)}${row}`, value, bulletin, date, days: workdaysBetween(date, query.date), serie: seriesContains(series, query.serie), project: sameProject(series, query.project) })
  }
  const rank = (m: LabMatch) => [Number(m.serie), Number(m.project), -m.days, m.row]
  return out.sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)]
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i]! - ra[i]!
    return 0
  })
}
