/**
 * Значения бирки мобильного приложения Somascan, которые нужны движку, чтобы дописать её в Probe той же строкой,
 * что записал бы телефон (`LabelWorkbook`). Перенесено из мобильного приложения (`features/recognition/label`,
 * `features/uploads/xlsx/uploadColumns`) — менять вместе с ним.
 */

/** Значение поля бирки. */
export type LabelValue = string | number | null

/** Поля бирки: ключ → значение. */
export type LabelRecord = Record<string, LabelValue>

/** Ключ поля «Плавка». */
export const HEAT_KEY = 'heat'

/** Ключ поля «Лист»: свой лист бирки важнее листа из настроек. */
export const SHEET_KEY = 'sheet'

/** Ключ поля «Форма поставки» (`bara` / `bobina`). */
export const PRODUCT_FORM_KEY = 'product_form'

/**
 * Плавка для сравнения: без пробелов и в верхнем регистре (`25r 00581` и `25R00581` — одна плавка;
 * число `253830` и текст `"253830"` — тоже). Пустая — `null`.
 */
export function heatKey(value: LabelValue | undefined): string | null {
  if (value === null || value === undefined) return null
  const key = String(value).replace(/\s+/g, '').toUpperCase()
  return key === '' ? null : key
}

/** Диаметр — первое число значения (`Ø12`, `R20`, `10 mm`). */
const LENGTH = /(\d+(?:[.,]\d+)?)/u

/** Вес: число и необязательно `kg`/`кг`. */
const WEIGHT = /^\s*(\d+(?:[.,]\d+)?)\s*(?:kg|кг)?\s*$/iu

/**
 * Число из значения размера или веса без пометок и единиц (`R20` → `20`, `2140 kg` → `2140`);
 * `null` — у размера нет ни одной цифры, у веса это не одно число.
 */
export function measureNumber(text: string, measure: 'length' | 'weight'): string | null {
  return (measure === 'length' ? LENGTH : WEIGHT).exec(text)?.[1] ?? null
}

/** Вид поля бирки. */
export type LabelFieldKind = 'code' | 'text' | 'number' | 'weight' | 'date' | 'time'

/** Вид колонки записи: вид поля; `record_number` и `recorded_at` — служебные колонки прежних версий (пропускаются). */
export type UploadColumnKind = LabelFieldKind | 'record_number' | 'recorded_at'

/** Колонка своего поля бирки (как её сохранил телефон). */
export interface UploadColumn {
  /** Ключ поля бирки. */
  key: string
  /** Название на языке интерфейса телефона. */
  header: string
  /** Все названия, по которым колонка опознаётся в шапке журнала. */
  aliases: string[]
  /** Вид значения. */
  kind: UploadColumnKind
}
