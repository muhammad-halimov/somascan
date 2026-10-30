/**
 * Числа с единицами, как их пишут на бирках: диаметр (`10 mm`, `Ø12`, `R20`, `Q16`) и вес (`2140 kg`).
 * Общие для показа бирки (`LabelFormatter`) и записи в журнал (`labTableCells`).
 */

/**
 * Диаметр — первое число значения: пометки перед ним бывают любые (Ø, D, R — гладкий пруток, Q, diam.),
 * после — единицы и прочее («Ø12 x 12 m»). В журнал и в поле правки идёт только оно.
 */
const LENGTH = /(\d+(?:[.,]\d+)?)/u

/** Вес: число и необязательно `kg`/`кг`. */
const WEIGHT = /^\s*(\d+(?:[.,]\d+)?)\s*(?:kg|кг)?\s*$/iu

/**
 * Число из значения размера или веса без пометок и единиц (`R20` → `20`, `Q16` → `16`, `2140 kg` → `2140`);
 * `null` — у размера нет ни одной цифры, у веса это не одно число.
 */
export function measureNumber(text: string, measure: 'length' | 'weight'): string | null {
  return (measure === 'length' ? LENGTH : WEIGHT).exec(text)?.[1] ?? null
}

/**
 * Ввод размера в правке: только цифры и один десятичный разделитель — пометки и единицы показывает просмотр,
 * в журнал идёт число («Q16» → «16», «5,5» остаётся).
 */
export function sizeInput(text: string): string {
  const cleaned = text.replace(/[^\d.,]/g, '')
  const separator = cleaned.search(/[.,]/)
  return separator < 0 ? cleaned : cleaned.slice(0, separator + 1) + cleaned.slice(separator + 1).replace(/[.,]/g, '')
}
