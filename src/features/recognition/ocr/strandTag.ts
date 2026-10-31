/**
 * Бирки канатов для преднапряжённого бетона (PC strand: BPM, D&D Drótáru). Плавки на них нет — в журнале на её месте
 * номер партии («LOT NO. 260909G392-06-2»), а без него — номер бухты («Coil Nr. 26D0222»); диаметр без подписи
 * берётся из обозначения по EN 10138-3 («Y1860 S7-12,9-F1-C1-R1»).
 *
 * Что считать бирку каната и как выглядит номер партии без подписи — правила в «Расширенных» → «Правила»
 * (`strand_words`, `strand_lot_masks` в `ruleLabels.ts`); номера у подписей находит правило поля «Партия / бунт».
 */
import { foldText } from './foldText'
import { cleanValue, latinize } from './valueReaders'

/**
 * Номер партии или бухты — от стольких букв и цифр: номер бухты в партии («COIL NO. 6») — порядковый,
 * не номер, который пишут в журнал.
 */
const MIN_ID_CHARS = 5

/** Буквы, которые OCR ставит вместо цифр: на месте цифры шаблона они становятся цифрами. */
const DIGIT_LOOKALIKES: Readonly<Record<string, string>> = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', S: '5', B: '8', Z: '2' }

/** Бирка каната: на ней есть одно из слов канатов (`strand_words`; строки — в сложенном виде, `foldText`). */
export function isStrandTag(foldedLines: readonly string[], words: readonly string[]): boolean {
  const keys = words.map(foldText).filter((key) => key.length >= 2)
  return foldedLines.some((text) => keys.some((key) => text.includes(key)))
}

/**
 * Слово по шаблону номера: 9 — цифра (буква-двойник на её месте становится цифрой: «O» → «0»), A — буква,
 * X — буква или цифра, дефис — дефис, прочее — тот же знак; длина — как у шаблона.
 * @returns Слово с исправленными цифрами или `null`, если не подходит.
 */
export function matchMask(word: string, mask: string): string | null {
  const pattern = mask.toUpperCase()
  if (word.length !== pattern.length) return null
  let result = ''
  for (let index = 0; index < pattern.length; index++) {
    const want = pattern[index]!
    const char = word[index]!
    if (want === '9') {
      const digit = /\d/.test(char) ? char : DIGIT_LOOKALIKES[char]
      if (!digit) return null
      result += digit
    } else if (want === 'A') {
      if (!/\p{L}/u.test(char)) return null
      result += char
    } else if (want === 'X') {
      if (!/[\p{L}\d]/u.test(char)) return null
      result += char
    } else {
      if (char !== want) return null
      result += char
    }
  }
  return result
}

/**
 * Номер партии каната без подписи (бледную «LOT NO» OCR не узнал или прочёл вместе со значением): слово
 * по одному из шаблонов (`strand_lot_masks`). Мелкий бледный шрифт OCR портит: пробелы вокруг дефисов, точка,
 * тире, подчёркивание или тильда вместо дефиса, буквы вместо цифр («26O9O9G392-06-2»), пробел посреди номера
 * («260909G 392-06-2» — слово берётся вместе с соседним). Буква шаблона, прочитанная цифрой («2609090392…»
 * вместо «260909G392…»), не угадывается: неверная плавка в журнале хуже пустой.
 */
export function findStrandLot(text: string, masks: readonly string[]): string | null {
  const words = latinize(cleanValue(text)).toUpperCase().replace(/\s*[-–—_~]\s*/g, '-').split(/\s+/)
    .map((word) => word.replace(/[.,;:]+$/, '').replace(/(?<=[A-Z0-9])\.(?=[A-Z0-9])/g, '-'))
  for (const word of [...words, ...words.slice(1).map((next, index) => words[index] + next)]) {
    for (const mask of masks) {
      const lot = matchMask(word, mask)
      if (lot) return lot
    }
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

/** Значение, найденное правилом поля «Партия / бунт», и его сила. */
export interface BatchValue {
  value: unknown
  score: number
}

/**
 * Плавка бирки каната: самый сильный номер партии или бухты, найденный у подписи (порядковый «6» — не номер),
 * иначе номер партии по шаблону (`findStrandLot`) в строках бирки.
 * @param batches Значения правила «Партия / бунт».
 * @param texts Строки бирки сверху вниз.
 * @param masks Шаблоны номера партии (`strand_lot_masks`).
 */
export function strandHeat(batches: readonly BatchValue[], texts: readonly string[], masks: readonly string[]): string | null {
  const ids = batches
    .filter((batch): batch is { value: string; score: number } => typeof batch.value === 'string' && /\d/.test(batch.value)
      && batch.value.replace(/[^\p{L}\d]/gu, '').length >= MIN_ID_CHARS)
    .sort((a, b) => b.score - a.score)
  return ids[0]?.value ?? texts.map((text) => findStrandLot(text, masks)).find((lot) => lot !== null) ?? null
}
