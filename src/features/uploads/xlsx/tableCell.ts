/**
 * Значения ячеек таблицы: преобразование значений бирки в ячейки Excel и обратно, сравнение.
 *
 * Числа пишутся числами, даты — датами Excel (видны как `2026-01-04`), остальное — текстом,
 * чтобы Excel не превращал коды с ведущими нулями в числа. Время остаётся текстом `HH:MM`.
 */
import type { CellValue } from 'exceljs'
import type { LabelValue } from '@/features/recognition/label/labelFields'
import type { UploadColumnKind } from './uploadColumns'

/** Дата в ячейке: день или момент с точностью до секунды. */
export interface TableDate {
  /** Дата, собранная из местных компонентов как UTC: так Excel показывает ровно те же цифры. */
  date: Date
  /** Точность: только день или вместе со временем. */
  precision: 'day' | 'second'
}

/** Что мы записываем в ячейку и что ожидаем прочитать обратно. */
export type TableCell = string | number | TableDate | null

/** Заголовок для сравнения: без регистра, лишних пробелов и различий в нормализации Unicode. */
export const normalizeHeader = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

/** Число с ведущими нулями. */
const pad = (value: number) => String(value).padStart(2, '0')

/** Строка вида `2026-01-04`. */
const isIsoDate = (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text)

/** «Голое» число: цифры с необязательной дробной частью через точку или запятую. */
const isBareNumber = (text: string) => /^-?\d+(?:[.,]\d+)?$/.test(text)

/** Дата Excel из календарных компонентов (как UTC, без сдвига часового пояса). */
export function excelDate(year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds))
}

/** Момент времени `ms` в местном часовом поясе как дата Excel с точностью до секунды. */
export function excelDateTime(ms: number): TableDate {
  const local = new Date(ms)
  return {
    date: excelDate(local.getFullYear(), local.getMonth() + 1, local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds()),
    precision: 'second',
  }
}

/** Ячейка для значения поля бирки по виду колонки. */
export function toTableCell(kind: UploadColumnKind, value: LabelValue | undefined): TableCell {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim()
  switch (kind) {
    case 'number':
    case 'weight':
      if (typeof value === 'number') return Number.isFinite(value) ? value : null
      return isBareNumber(text) ? Number(text.replace(',', '.')) : text
    case 'date': {
      if (!isIsoDate(text)) return text
      const [year, month, day] = text.split('-').map(Number) as [number, number, number]
      const date = excelDate(year, month, day)
      // Несуществующая дата (например, 31 февраля) остаётся текстом, как напечатано.
      const isReal = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      return isReal ? { date, precision: 'day' } : text
    }
    default:
      return text
  }
}

/** Текст ячейки, как её прочитал ExcelJS: форматированный текст, формула, ссылка — всё сводится к строке. */
export function cellText(value: CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return cellKey({ date: value, precision: hasTime(value) ? 'second' : 'day' })
  if ('richText' in value) return value.richText.map((run) => run.text).join('')
  if ('result' in value) return value.result === undefined || value.result === null ? '' : cellText(value.result as CellValue)
  if ('text' in value) return typeof value.text === 'string' ? value.text : cellText(value.text as CellValue)
  if ('error' in value) return value.error
  return String(value)
}

/** Есть ли у даты часть времени. */
const hasTime = (date: Date) => date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0

/** Ячейка из прочитанного значения. */
export function readCell(value: CellValue): TableCell {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (value instanceof Date) return { date: value, precision: hasTime(value) ? 'second' : 'day' }
  if (typeof value === 'object' && 'result' in value && value.result instanceof Date) return readCell(value.result)
  if (typeof value === 'object' && 'result' in value && typeof value.result === 'number') return value.result
  const text = cellText(value)
  return text === '' ? null : text
}

/** Ключ для сравнения ячеек: даты и числа — в каноническом тексте, строки — без крайних пробелов. */
export function cellKey(cell: TableCell): string {
  if (cell === null) return ''
  if (typeof cell === 'number') return String(cell)
  if (typeof cell === 'string') return cell.trim()
  const { date, precision } = cell
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  if (precision === 'day') return day
  return `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
}

/** Совпадают ли записанная и прочитанная ячейки. */
export const sameCell = (expected: TableCell, actual: TableCell) => cellKey(expected) === cellKey(actual)
