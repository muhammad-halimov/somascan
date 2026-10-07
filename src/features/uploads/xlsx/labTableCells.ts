/**
 * Значения бирки в виде, принятом в журнале проб: вес `8126Kg`, дата `14.01.2026`,
 * плавка — числом, если это просто цифры, диаметр — числом миллиметров (`10`), в колонку
 * «Bobina» или «Bara» по форме поставки.
 */
import type { LabelRecord, LabelValue } from '@/features/recognition/label/labelFields'
import { measureNumber } from '@/features/recognition/label/measure'
import { PRODUCT_FORM_KEY } from '@/features/recognition/label/productForm'
import type { LabColumnKind } from './labTableLayout'
import type { TableCell } from './tableCell'

/** Двузначное число с ведущим нулём. */
const pad2 = (value: number) => String(value).padStart(2, '0')

/** Текст значения без крайних пробелов; пустое — `null`. */
function textOf(value: LabelValue | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

/** Дата поступления как в журнале: `ДД.ММ.ГГГГ` по местному времени. */
export function arrivalDateText(ms: number): string {
  const date = new Date(ms)
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`
}

/**
 * Вес как в журнале: число килограммов с `Kg` (`8126Kg`). Не число (например, «2140 kg approx») —
 * как прочитано.
 */
export function quantityCell(value: LabelValue | undefined): TableCell {
  if (typeof value === 'number') return Number.isFinite(value) ? `${value}Kg` : null
  const text = textOf(value)
  if (text === null) return null
  const kilograms = measureNumber(text, 'weight')
  return kilograms === null ? text : `${Number(kilograms.replace(',', '.'))}Kg`
}

/**
 * Плавка: только цифры без ведущего нуля — числом (как в журнале), иначе текстом,
 * чтобы не потерять нули и буквы (`0016`, `25R00205`, `2601-2-315-31`).
 */
export function heatCell(value: LabelValue | undefined): TableCell {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : String(value)
  const text = textOf(value)
  if (text === null) return null
  return /^[1-9]\d{0,14}$/.test(text) ? Number(text) : text
}

/** Диаметр: «10 mm», «Ø12», «R20» → число миллиметров; что-то другое — как прочитано. */
export function diameterCell(value: LabelValue | undefined): TableCell {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = textOf(value)
  if (text === null) return null
  const millimetres = measureNumber(text, 'length')
  return millimetres === null ? text : Number(millimetres.replace(',', '.'))
}

/** Что пишется в известную колонку журнала (кроме «Nr. Crt.» и даты — их задаёт запись). */
export function labCell(kind: LabColumnKind, label: LabelRecord): TableCell {
  const form = label[PRODUCT_FORM_KEY]
  switch (kind) {
    case 'quantity':
      return quantityCell(label.weight_kg)
    case 'heat':
      return heatCell(label.heat)
    case 'producer':
      return textOf(label.producer)
    case 'coil':
      return form === 'bobina' ? diameterCell(label.size) : null
    case 'bar':
      return form === 'bara' ? diameterCell(label.size) : null
    case 'qualityDoc':
      return textOf(label.quality_doc)
    default:
      return null
  }
}
