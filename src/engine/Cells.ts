/**
 * Ячейки и адреса ExcelJS.
 *
 * Значение ячейки приводится к простому виду (`cellValue`): у формулы — результат, у текста с форматированием —
 * сам текст. Стиль меняется только заменой объекта (`setStyle`, `copyStyle`): ExcelJS отдаёт общий объект стиля
 * многим ячейкам, и `cell.fill = …` перекрасил бы их все разом.
 */
import type ExcelJS from 'exceljs'
import { cleanText } from '@/shared/names'

/** Простое значение ячейки. */
export type Scalar = string | number | boolean | Date | null

/** Значение ячейки: результат формулы, текст rich text или гиперссылки; `null` — пусто. */
export function cellValue(cell: ExcelJS.Cell): Scalar {
  let v: unknown = cell.value
  if (v == null) return null
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) v = o.result
    else if (Array.isArray(o.richText)) v = (o.richText as Array<{ text: string }>).map((t) => t.text).join('')
    else if ('text' in o) v = o.text
    else return null
  }
  return (v ?? null) as Scalar
}

/** Строка без лишних пробелов. */
export const text = cleanText

/** Текст ячейки. */
export const cellText = (cell: ExcelJS.Cell): string => text(cellValue(cell))

/** Число из значения: само число или первое число в тексте («12 кг» → 12). */
export function toNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return v
  const m = String(v).match(/[\d.]+/)
  return m ? Number(m[0]) : null
}

/** Дата блока: «11.09.26», «06,10,26», «21.02.206» → дата; иначе `null`. Без года — 2026. */
export function parseBlockDate(v: unknown): Date | null {
  if (v instanceof Date) return v
  const m = text(v).replace(/,/g, '.').match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/)
  if (!m) return null
  const y = m[3] ? 2000 + Number(m[3].slice(-2)) : 2026
  return new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])))
}

/** Сегодня в виде «19.10.26» — дата нового блока. */
export function todayLabel(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(now.getDate())}.${p(now.getMonth() + 1)}.${String(now.getFullYear()).slice(2)}`
}

/** Глубокая копия стиля. */
const cloneStyle = <T>(style: T): T => JSON.parse(JSON.stringify(style ?? {})) as T

/** Меняет стиль ячейки заменой объекта (см. описание модуля). */
export function setStyle(cell: ExcelJS.Cell, patch: Partial<ExcelJS.Style>): void {
  cell.style = { ...cloneStyle(cell.style), ...patch } as ExcelJS.Style
}

/** Копирует стиль одной ячейки в другую. */
export function copyStyle(from: ExcelJS.Cell, to: ExcelJS.Cell): void {
  to.style = cloneStyle(from.style)
}

/** Стороны рамки. */
export type BorderSide = 'left' | 'right' | 'top' | 'bottom'

/** Есть ли у ячейки рамка с этой стороны (`style="none"` в файле — это НЕТ рамки). */
export function hasBorder(cell: ExcelJS.Cell | null | undefined, side: BorderSide): boolean {
  const style = cell?.border?.[side]?.style as string | undefined
  return !!style && style !== 'none'
}

/** Есть ли у ячейки хоть одна настоящая рамка. */
export function hasAnyBorder(cell: ExcelJS.Cell): boolean {
  const b = cell.border
  return !!b && Object.values(b).some((q) => {
    const style = (q as { style?: string } | undefined)?.style
    return !!style && style !== 'none'
  })
}

/** Пусты ли `n` ячеек строки `r` начиная с колонки `c`. */
export function emptyAt(ws: ExcelJS.Worksheet, r: number, c: number, n: number): boolean {
  for (let i = 0; i < n; i++) if (cellValue(ws.getCell(r, c + i)) != null) return false
  return true
}

/** Заливка-цвет ячейки (сплошная): ARGB, `"x"` для цвета темы, `""` — без заливки. */
export function solidFill(cell: ExcelJS.Cell): string {
  const f = cell.fill
  if (!f || f.type !== 'pattern' || f.pattern !== 'solid') return ''
  return (f.fgColor as { argb?: string } | undefined)?.argb ?? 'x'
}

/** Залита ли ячейка ровно этим цветом. */
export function hasFill(cell: ExcelJS.Cell, argb: string): boolean {
  const f = cell.fill
  return f?.type === 'pattern' && (f.fgColor as { argb?: string } | undefined)?.argb === argb
}

// ── Адреса ──────────────────────────────────────────────────────────────────

/** Номер колонки → буквы: 126 → «DV». */
export function columnLetters(n: number): string {
  let s = ''
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** Буквы колонки → номер: «DV» → 126. */
export const columnNumber = (letters: string): number => [...letters].reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0)

/** Объединение ячеек в числах. */
export interface MergeRange {
  /** Как записано в файле, например «DV6:DV9». */
  ref: string
  r1: number
  c1: number
  r2: number
  c2: number
}

/** «DV6» → [строка, колонка]. */
function decodeCell(ref: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!m) throw new Error(`адрес ячейки «${ref}» не разобран`)
  return [Number(m[2]), columnNumber(m[1]!)]
}

/** «DV6:DV9» → диапазон. */
export function decodeRange(ref: string): MergeRange {
  const [a, b] = ref.split(':')
  const [r1, c1] = decodeCell(a!)
  const [r2, c2] = decodeCell(b ?? a!)
  return { ref, r1, c1, r2, c2 }
}
