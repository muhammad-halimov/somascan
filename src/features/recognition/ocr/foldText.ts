/**
 * Сравнение текста бирки без оглядки на регистр, диакритику и знаки: «Șarjă», «SARJA» и «sarja» — одно
 * и то же, «Charge/Adag/Wytop:» — три подписи подряд. OCR путает «/» с «l» или «I» («ChargelAdag»), поэтому
 * подписи ищутся в тексте без пробелов и знаков, а короткие — только с начала слова, чтобы «lot» не нашёлся
 * внутри «pilot», а «data» — внутри «update».
 */

/** Буквы, которые разложение NFKD не сводит к латинице. */
const SPECIAL_LETTERS: Readonly<Record<string, string>> = { ß: 'ss', ø: 'o', ł: 'l', đ: 'd', ı: 'i', æ: 'ae', œ: 'oe', þ: 'th' }

/** Буква или цифра любого алфавита. */
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

/** Подписи не длиннее стольких букв ищутся только с начала слова. */
const SHORT_LABEL = 4

/** Подписи не длиннее стольких букв должны ещё и заканчиваться вместе со словом («lot», но не «lotus»). */
const TINY_LABEL = 3

/** Символ в сложенном виде: строчные буквы без диакритики и цифры; знаки и пробелы — пустая строка. */
export function foldChar(char: string): string {
  const lower = char.toLowerCase()
  const special = SPECIAL_LETTERS[lower]
  if (special) return special
  return lower.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '')
}

/** Текст в сложенном виде: только буквы и цифры («Șarjă nr.» → `sarjanr`). */
export const foldText = (text: string) => Array.from(text, foldChar).join('')

/** Сложенный текст с привязкой к исходному. */
export interface FoldedText {
  /** Буквы и цифры исходного текста в сложенном виде. */
  text: string
  /** Для каждого символа `text` — позиция его буквы в исходном тексте. */
  origin: number[]
  /**
   * Начинается ли с этого символа слово исходного текста: после пробела или знака, на смене строчной буквы
   * на заглавную («ChargelAdag» — OCR прочёл «/» как «l») и на переходе между буквами и цифрами.
   */
  wordStart: boolean[]
}

/** Складывает текст, запоминая, откуда взят каждый символ и где начинаются слова. */
export function foldWithMap(source: string): FoldedText {
  let text = ''
  const origin: number[] = []
  const wordStart: boolean[] = []
  let previous = ''
  for (let index = 0; index < source.length;) {
    const char = String.fromCodePoint(source.codePointAt(index)!)
    const folded = foldChar(char)
    const startsWord = text === ''
      || !LETTER_OR_DIGIT.test(previous)
      || (/\p{Ll}/u.test(previous) && /\p{Lu}/u.test(char))
      || /\p{L}/u.test(previous) !== /\p{L}/u.test(char)
    for (let offset = 0; offset < folded.length; offset++) {
      text += folded[offset]
      origin.push(index)
      wordStart.push(offset === 0 && startsWord)
    }
    previous = char
    index += char.length
  }
  return { text, origin, wordStart }
}

/** Найденная подпись: положение в сложенном тексте (`end` — за последним символом). */
export interface FoldedMatch {
  start: number
  end: number
}

/**
 * Все вхождения подписи в текст.
 * @param folded Сложенный текст строки.
 * @param label Подпись, уже сложенная (`foldText`).
 */
export function findLabel(folded: FoldedText, label: string): FoldedMatch[] {
  const matches: FoldedMatch[] = []
  if (!label) return matches
  for (let start = folded.text.indexOf(label); start !== -1; start = folded.text.indexOf(label, start + 1)) {
    const end = start + label.length
    if (label.length <= SHORT_LABEL && !folded.wordStart[start]) continue
    if (label.length <= TINY_LABEL && end < folded.text.length && !folded.wordStart[end]) continue
    matches.push({ start, end })
  }
  return matches
}

/** Позиция в исходном тексте сразу за символом `end - 1` сложенного текста. */
export function sourceEnd(folded: FoldedText, source: string, end: number): number {
  if (end <= 0) return 0
  const index = folded.origin[end - 1]!
  return index + String.fromCodePoint(source.codePointAt(index)!).length
}
