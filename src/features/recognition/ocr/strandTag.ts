/**
 * Бирки канатов для преднапряжённого бетона (PC strand: BPM, D&D Drótáru). Плавки на них нет — в журнале на её месте
 * номер партии («LOT NO. 260909G392-06-2»), а без него — номер бухты («Coil Nr. 26D0222»); диаметр без подписи
 * берётся из обозначения по EN 10138-3 («Y1860 S7-12,9-F1-C1-R1»).
 *
 * Номера партии и бухты находит правило поля «Партия / бунт» (его подписи — в «Расширенных» → «Правила»); здесь —
 * что из найденного считать плавкой и как узнать бирку каната и номер партии без подписи.
 */
import { cleanValue, latinize } from './valueReaders'

/** Слова канатов в сложенном тексте (`foldText`): «PC strand», «toroane» (рум.), «Litze» (нем.), «канат». */
const STRAND_WORDS = /strand|toroan|litze|канат/

/**
 * Номер партии или бухты — от стольких букв и цифр: номер бухты в партии («COIL NO. 6») — порядковый,
 * не номер, который пишут в журнал.
 */
const MIN_ID_CHARS = 5

/** Номер партии каната: дата производства ГГММДД, код и группы через дефисы («260909G392-06-2»). */
const STRAND_LOT = /^\d{6}[A-Z0-9]{2,8}(?:-[A-Z0-9]{1,4}){1,3}$/

/** Буквы, которые OCR ставит вместо цифр, — в дате номера партии. */
const DATE_LOOKALIKES: Readonly<Record<string, string>> = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', S: '5', B: '8', Z: '2' }

/**
 * Номер партии каната без подписи (бледную «LOT NO» OCR не узнал или прочёл вместе со значением): слово — код,
 * который начинается с даты производства ГГММДД и идёт через дефисы: «260909G392-06-2» (BPM). Мелкий бледный
 * шрифт OCR портит: пробелы вокруг дефисов и тире, подчёркивание или тильда вместо дефиса, буквы вместо цифр
 * в дате («26O9O9G392-06-2»), пробел посреди номера («260909G 392-06-2» — слово берётся вместе с соседним).
 */
export function findStrandLot(text: string): string | null {
  const words = latinize(cleanValue(text)).toUpperCase().replace(/\s*[-–—_~]\s*/g, '-').split(/\s+/)
    .map((word) => word.replace(/[.,;:]+$/, ''))
  for (const word of [...words, ...words.slice(1).map((next, index) => words[index] + next)]) {
    const fixed = word.slice(0, 6).replace(/[OQDILSBZ|]/g, (char) => DATE_LOOKALIKES[char]!) + word.slice(6)
    if (STRAND_LOT.test(fixed)) return fixed
  }
  return null
}

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

/** Бирка каната: на ней есть слово каната (строки — в сложенном виде). */
export const isStrandTag = (foldedLines: readonly string[]) => foldedLines.some((text) => STRAND_WORDS.test(text))

/** Значение, найденное правилом поля «Партия / бунт», и его сила. */
export interface BatchValue {
  value: unknown
  score: number
}

/**
 * Плавка бирки каната: самый сильный номер партии или бухты, найденный у подписи (порядковый «6» — не номер),
 * иначе номер партии по виду (`findStrandLot`) в строках бирки.
 * @param batches Значения правила «Партия / бунт».
 * @param texts Строки бирки сверху вниз.
 */
export function strandHeat(batches: readonly BatchValue[], texts: readonly string[]): string | null {
  const ids = batches
    .filter((batch): batch is { value: string; score: number } => typeof batch.value === 'string' && /\d/.test(batch.value)
      && batch.value.replace(/[^\p{L}\d]/gu, '').length >= MIN_ID_CHARS)
    .sort((a, b) => b.score - a.score)
  return ids[0]?.value ?? texts.map(findStrandLot).find((lot) => lot !== null) ?? null
}
