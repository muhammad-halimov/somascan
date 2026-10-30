/**
 * Сверка номера плавки с другими местами бирки, где он повторяется. Ржавчина и грязь портят одну-две цифры
 * («2602N0668» читается как «2602N0888»), а хвост плавки часто напечатан ещё раз в чистом месте: в серийном
 * номере Suez Steel («L6N0668021B2260204» — «N0668»), в коде пачки Çolakoğlu («TZA1324C018»), в QR или
 * DataMatrix (они читаются без ошибок).
 */

/** Откуда сверять: текст и насколько ему верить. */
export interface HeatSource {
  text: string
  /** Уверенность OCR 0…1; `null` — неизвестна. */
  confidence: number | null
  /** Код (QR, DataMatrix, штрихкод): читается без ошибок — ему веришь всегда. */
  exact: boolean
}

/** Пары цифр, которые OCR путает на грязной или ржавой бирке (замкнутые и полузамкнутые контуры, 1 и 7). */
const CONFUSABLE = new Set(['06', '08', '09', '38', '39', '56', '58', '68', '69', '89', '17'])

const confusable = (a: string, b: string) => CONFUSABLE.has(a < b ? a + b : b + a)

/** Самый короткий сверяемый хвост плавки: с буквой («N0668») — 5 знаков, только цифры — 6. */
const MIN_TAIL_WITH_LETTER = 5
const MIN_DIGIT_TAIL = 6

/** Длинные номера (серийный, код пачки), в которых ищется хвост плавки; короче — случайные слова и числа. */
const MIN_TEXT_TOKEN = 10

/** Исправление плавки по одному источнику. */
interface Fix {
  heat: string
  confidence: number | null
  exact: boolean
}

/**
 * Хвост плавки в окне `window`: буквы — те же на тех же местах, цифры отличаются не больше чем `limit` раз,
 * и каждое отличие — путаемые цифры. Возвращает число отличий или `null`, если не похоже.
 */
function tailDifference(tail: string, window: string, limit: number): number | null {
  let differences = 0
  for (let index = 0; index < tail.length; index++) {
    const a = tail[index]!
    const b = window[index]!
    if (a === b) continue
    if (!/\d/.test(a) || !/\d/.test(b) || !confusable(a, b) || ++differences > limit) return null
  }
  return differences
}

/**
 * Плавка, сверенная с источниками. Если хвост плавки где-то повторяется как есть — плавка верна. Иначе если
 * он повторяется с путаемыми цифрами (одна у хвоста из цифр, до двух у хвоста с буквой) — цифры берутся оттуда:
 * из кода — всегда, из текста — если OCR уверен в нём больше, чем в строке плавки.
 * @param heat Номер плавки, как прочитан.
 * @param confidence Уверенность OCR в строке плавки; `null` — неизвестна.
 * @param sources Где ещё искать плавку на бирке.
 */
export function crossCheckHeat(heat: string, confidence: number | null, sources: readonly HeatSource[]): string {
  const tokens = sources.flatMap((source) => source.text.toUpperCase().split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= (source.exact ? MIN_TAIL_WITH_LETTER : MIN_TEXT_TOKEN))
    .map((token) => ({ ...source, token })))
  for (let length = heat.length; length >= MIN_TAIL_WITH_LETTER; length--) {
    const tail = heat.slice(-length)
    const withLetter = /[A-Z]/.test(tail)
    if (!withLetter && length < MIN_DIGIT_TAIL) break
    const limit = withLetter ? 2 : 1
    const fixes: Fix[] = []
    for (const { token, confidence: sourceConfidence, exact } of tokens) {
      for (let start = 0; start + length <= token.length; start++) {
        const window = token.slice(start, start + length)
        const differences = tailDifference(tail, window, limit)
        if (differences === 0) return heat
        if (differences !== null) fixes.push({ heat: heat.slice(0, -length) + window, confidence: sourceConfidence, exact })
      }
    }
    const trusted = fixes.find((fix) => fix.exact)
      ?? fixes.filter((fix) => fix.confidence !== null && confidence !== null && fix.confidence > confidence)
        .sort((a, b) => b.confidence! - a.confidence!)[0]
    if (trusted) return trusted.heat
    if (fixes.length > 0) return heat
  }
  return heat
}
