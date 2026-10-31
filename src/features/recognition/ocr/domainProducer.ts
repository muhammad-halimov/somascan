/**
 * Производитель по почте или сайту завода на бирке, когда названия на ней нет или OCR его не прочёл:
 * «info@sovel.gr» — Sovel, «www.oamkft.hu» — OAM (из списка: домен начинается с его сокращения),
 * «sales@company.com» — Company (своё название из домена, если в списке похожего нет).
 * Бесплатная почта (gmail.com…) завод не называет — её домены не в счёт.
 */
import { foldText } from './foldText'

/** Почта: домен после «@» (OCR ставит пробелы вокруг «@» и точек — их убирает `squeeze`). */
const EMAIL = /[\p{L}\p{N}._%+-]+@([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)/gu

/** Сайт — только с «www.» или «http(s)://»: иначе за домен сошли бы «EN 10080.2012» и «B500C.dat». */
const SITE = /(?:https?:\/\/|\bwww\.)([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+)/giu

/** Бесплатная и общая почта: по ней завод не узнать. */
const FREE_MAIL = new Set([
  'gmail', 'googlemail', 'yahoo', 'ymail', 'outlook', 'hotmail', 'live', 'msn', 'icloud', 'me', 'aol', 'gmx',
  'mail', 'yandex', 'ya', 'rambler', 'inbox', 'list', 'bk', 'ukr', 'i', 'proton', 'protonmail', 'zoho', 'abv', 'web',
])

/** Общие зоны второго уровня («com.eg», «co.uk»): название — перед ними. */
const GENERIC_ZONES = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'ac', 'biz'])

/** Пробелы, которые OCR ставит вокруг «@» и точек адреса: «info @ sovel . gr» → «info@sovel.gr». */
const squeeze = (text: string) => text.replace(/\s*@\s*/g, '@').replace(/\s*\.\s*(?=[\p{L}\p{N}])/gu, '.')

/** Название из домена: часть перед зоной, без «www» и общих зон второго уровня («mail.suezsteel.com.eg» → «suezsteel»). */
function domainName(host: string): string | null {
  const parts = host.toLowerCase().split('.').filter(Boolean)
  parts.pop()
  while (parts.length > 1 && GENERIC_ZONES.has(parts[parts.length - 1]!)) parts.pop()
  const name = parts[parts.length - 1]
  return name && name !== 'www' ? foldText(name) : null
}

/**
 * Названия компаний из почты и сайтов в строках, по порядку (без бесплатной почты и повторов).
 * @param texts Строки бирки сверху вниз (и текст кодов).
 */
export function companyDomains(texts: readonly string[]): string[] {
  const names: string[] = []
  for (const text of texts) {
    const squeezed = squeeze(text)
    for (const match of [...squeezed.matchAll(EMAIL), ...squeezed.matchAll(SITE)]) {
      const name = domainName(match[1]!)
      if (name && name.length >= 3 && !FREE_MAIL.has(name) && !names.includes(name)) names.push(name)
    }
  }
  return names
}

/**
 * Известный поставщик по названию из домена: домен совпадает с названием, начинается с него или с его первого
 * слова-сокращения («oamkft» — «OAM Ózdi Acélművek»), либо название начинается с домена (от четырёх букв).
 * Из подходящих — с самым длинным названием.
 */
export function supplierByDomain(names: readonly string[], suppliers: readonly string[]): string | null {
  for (const domain of names) {
    let best: { name: string; length: number } | null = null
    for (const supplier of suppliers) {
      const key = foldText(supplier)
      const firstWord = foldText(supplier.split(/\s+/)[0] ?? '')
      const matches = key.length >= 3 && (domain.startsWith(key) || (domain.length >= 4 && key.startsWith(domain)))
        || (firstWord.length >= 3 && domain.startsWith(firstWord))
      if (matches && (!best || key.length > best.length)) best = { name: supplier, length: key.length }
    }
    if (best) return best.name
  }
  return null
}

/** Своё название компании из домена: короткое — заглавными, как сокращение («oam» → «OAM»), иначе с заглавной. */
export const companyFromDomain = (name: string) => (name.length <= 4 ? name.toUpperCase() : name[0]!.toUpperCase() + name.slice(1))
