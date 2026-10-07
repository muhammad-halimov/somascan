/**
 * Разбор дат выхода для списков моделей.
 * Все функции возвращают `YYYY-MM-DD` или `null`.
 */

/** Английские названия месяцев в том виде, в каком они встречаются в описаниях моделей. */
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** Дополняет месяц или день нулём слева. */
const pad = (value: number) => String(value).padStart(2, '0')

/** Собирает `YYYY-MM-DD`, отбрасывая значения вне допустимого диапазона. */
const isoDate = (year: number, month: number, day = 1) =>
  month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${year}-${pad(month)}-${pad(day)}` : null

/** Unix-секунды (OpenAI `created`) → дата. */
export function fromUnixSeconds(seconds: number | undefined) {
  return seconds && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString().slice(0, 10) : null
}

/** Метка времени RFC 3339 (Anthropic `created_at`) или `YYYY-MM[-DD]` → дата. */
export function fromTimestamp(value: string | undefined) {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10)
}

/**
 * Находит дату, записанную в свободном тексте, как это делает Gemini в id, версиях и описаниях:
 * `2025-05-19`, `05-2026`, `June 17th, 2025`, `June of 2025`.
 * Даты только с месяцем приводятся к первому числу месяца.
 */
export function findDateInText(text: string): string | null {
  const full = /(20\d{2})-(\d{2})-(\d{2})/.exec(text)
  if (full) return isoDate(Number(full[1]), Number(full[2]), Number(full[3]))

  const monthYear = /(?:^|\D)(\d{2})-(20\d{2})(?!\d)/.exec(text)
  if (monthYear) return isoDate(Number(monthYear[2]), Number(monthYear[1]))

  const written = new RegExp(`(${MONTHS.join('|')})\\s+(?:of\\s+)?(?:(\\d{1,2})(?:st|nd|rd|th)?,?\\s+)?(20\\d{2})`, 'i').exec(text)
  if (written) {
    const month = MONTHS.indexOf(written[1].toLowerCase()) + 1
    return isoDate(Number(written[3]), month, written[2] ? Number(written[2]) : 1)
  }
  return null
}
