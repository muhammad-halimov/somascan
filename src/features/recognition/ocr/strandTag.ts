/**
 * Бирки канатов для преднапряжённого бетона (PC strand: BPM, D&D Drótáru). Плавки на них нет — в журнале на её месте
 * номер партии («LOT NO. 260909G392-06-2»), а без него — номер бухты («Coil Nr. 26D0222»): их находит поле
 * «Партия / бунт» по своим подписям (правятся в «Расширенных» → «Правила»). Диаметр без подписи берётся
 * из обозначения по EN 10138-3 («Y1860 S7-12,9-F1-C1-R1»).
 */

/** Слова канатов в сложенном тексте (`foldText`): «PC strand», «toroane» (рум.), «Litze» (нем.), «канат». */
const STRAND_WORDS = /strand|toroan|litze|канат/

/**
 * Номер партии или бухты — от стольких букв и цифр: номер бухты в партии («COIL NO. 6») — порядковый,
 * не номер, который пишут в журнал.
 */
const MIN_ID_CHARS = 5

/** Бирка каната: на ней есть слово каната (строки — в сложенном виде). */
export const isStrandTag = (foldedLines: readonly string[]) => foldedLines.some((text) => STRAND_WORDS.test(text))

/**
 * Диаметр каната (PC strand) из обозначения по EN 10138-3, когда подписи диаметра нет: «Y1860 S7-12,9-F1-C1-R1»
 * (7 проволок, 12,9 мм), «Y1860S7-15,2», «S3-6,5». Пишется как напечатано: «12,9 mm».
 */
export function findStrandSize(text: string): string | null {
  const match = /(?:^|[^\p{L}\d])(?:Y\d{4}\s*)?S[237]G?\s*[-–—]\s*(\d{1,2}[.,]\d{1,2})(?!\d)/iu.exec(text)
  if (!match) return null
  const size = Number.parseFloat(match[1]!.replace(',', '.'))
  return size >= 4 && size <= 20 ? `${match[1]} mm` : null
}

/** Значение, найденное полем «Партия / бунт», и его сила. */
export interface BatchValue {
  value: unknown
  score: number
}

/**
 * Плавка бирки каната: самый сильный номер партии или бухты из поля «Партия / бунт» (порядковый «6» — не номер).
 * @param batches Значения поля «Партия / бунт».
 */
export function strandHeat(batches: readonly BatchValue[]): string | null {
  const ids = batches
    .filter((batch): batch is { value: string; score: number } => typeof batch.value === 'string' && /\d/.test(batch.value)
      && batch.value.replace(/[^\p{L}\d]/gu, '').length >= MIN_ID_CHARS)
    .sort((a, b) => b.score - a.score)
  return ids[0]?.value ?? null
}
