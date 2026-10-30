/**
 * Производитель по списку известных поставщиков: название завода на бирке (в шапке, в логотипе, в адресе)
 * сверяется со списком — так «OAM Ozdi AcelmuvekKt.» из OCR становится «OAM Ózdi Acélművek», как в журнале.
 * Сравнение — без регистра, диакритики, пробелов и знаков; длинным названиям прощается одна-две ошибки OCR.
 */
import { foldText, foldWithMap } from './foldText'

/** Название из списка, найденное в тексте. */
export interface SupplierMatch {
  /** Название, как в списке. */
  name: string
  /** Совпало без ошибок. */
  exact: boolean
}

/** Названия не длиннее стольких букв ищутся только отдельным словом («MDA», но не «…mda…»). */
const SHORT_NAME = 4

/**
 * Первые слова названий, которые сами по себе завод не называют (страна, город, «сталеплавильный завод»
 * на разных языках): по ним одним поставщика не узнать.
 */
const GENERIC_FIRST_WORDS = new Set(['acciaierie', 'ferriere', 'hellenic', 'moldova', 'promet', 'stomana', 'power', 'suez', 'alfa', 'diler'])

/** Первое слово названия узнаёт поставщика, если в нём не меньше стольких букв (и оно не общее). */
const DISTINCTIVE_WORD = 6

/** Сколько ошибок OCR простить названию такой длины. */
const allowedErrors = (length: number) => (length >= 12 ? 2 : length >= 7 ? 1 : 0)

/**
 * Наименьшее число правок, чтобы `needle` совпал с каким-нибудь куском `haystack`
 * (расстояние Левенштейна до лучшей подстроки).
 */
function substringDistance(needle: string, haystack: string): number {
  let previous: number[] = Array.from({ length: haystack.length + 1 }, () => 0)
  for (let i = 1; i <= needle.length; i++) {
    const current: number[] = [i]
    for (let j = 1; j <= haystack.length; j++) {
      const cost = needle[i - 1] === haystack[j - 1] ? 0 : 1
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost))
    }
    previous = current
  }
  return Math.min(...previous)
}

/** Слова текста в сложенном виде (для коротких названий). */
function foldedWords(text: string): string[] {
  const folded = foldWithMap(text)
  const words: string[] = []
  for (let index = 0; index < folded.text.length; index++) {
    if (folded.wordStart[index] || words.length === 0) words.push('')
    words[words.length - 1] += folded.text[index]
  }
  return words
}

/**
 * Лучший поставщик в одной строке: точное совпадение важнее приблизительного, длинное название — короткого.
 * @param text Строка OCR.
 * @param suppliers Известные поставщики.
 */
export function matchSupplier(text: string, suppliers: readonly string[]): SupplierMatch | null {
  const folded = foldText(text)
  if (folded.length < 2) return null
  let best: (SupplierMatch & { length: number }) | null = null
  for (const name of suppliers) {
    const key = foldText(name)
    if (key.length < 2) continue
    let exact = false
    let near = false
    if (key.length <= SHORT_NAME) {
      exact = foldedWords(text).includes(key)
    } else {
      exact = folded.includes(key)
      const errors = allowedErrors(key.length)
      near = !exact && errors > 0 && folded.length >= key.length - errors && substringDistance(key, folded) <= errors
    }
    // Название целиком не прочлось (вторая строка шапки размыта, «METALURJIAS»), но первое слово — отличительное
    // («COLAKOGLU»): поставщик узнаётся по нему — как приблизительное совпадение.
    if (!exact && !near) {
      const firstWord = foldText(name.split(/\s+/)[0] ?? '')
      near = name.trim().includes(' ') && firstWord.length >= DISTINCTIVE_WORD && !GENERIC_FIRST_WORDS.has(firstWord)
        && foldedWords(text).includes(firstWord)
    }
    if (!exact && !near) continue
    const better = !best || (exact && !best.exact) || (exact === best.exact && key.length > best.length)
    if (better) best = { name, exact, length: key.length }
  }
  return best && { name: best.name, exact: best.exact }
}

/**
 * Поставщик по строкам бирки в порядке важности (сначала строка рядом с подписью «Producer», потом остальные):
 * первое точное совпадение, иначе первое приблизительное; `null`, если ничего не похоже.
 */
export function findSupplier(texts: readonly string[], suppliers: readonly string[]): string | null {
  let near: string | null = null
  for (const text of texts) {
    const match = matchSupplier(text, suppliers)
    if (match?.exact) return match.name
    if (match && !near) near = match.name
  }
  return near
}
