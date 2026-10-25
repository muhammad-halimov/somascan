/**
 * Нормализация названий и «похожесть» — основа привязок:
 *   проект в Consum  ↔ проект программы (алиасы) ↔ лист в Sarjele;
 *   элемент в Consum ↔ блок в Sarjele.
 * Автоматически связываем только при точном совпадении после нормализации; остальное — подсказки.
 *
 * Модуль без зависимостей: его используют и движок, и окно (буквы ID, имя листа).
 */

/** Убирает диакритику: «Ţ» → «T», «ă» → «a». */
export const deburr = (text: unknown): string => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Ключ сравнения: «Petra_2025» → «PETRA 2025». */
export const nameKey = (text: unknown): string =>
  deburr(text).toUpperCase().replace(/[^A-Z0-9А-ЯЁ]+/g, ' ').trim().replace(/\s+/g, ' ')

/** Ключ проекта: то же, но без годов — Petra, Petra_2025 и PETRA 2026 это один проект. */
export const projectKey = (text: unknown): string =>
  nameKey(text).replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim()

/** Расстояние Левенштейна. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m || !n) return Math.max(m, n)
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]!
}

/** Похожесть двух названий, 0…1 (1 — совпадают после нормализации). */
export function similarity(a: unknown, b: unknown, normalize: (text: unknown) => string = nameKey): number {
  const x = normalize(a)
  const y = normalize(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const ta = new Set(x.split(' '))
  const tb = new Set(y.split(' '))
  const inter = [...ta].filter((t) => tb.has(t)).length
  const jaccard = inter / (ta.size + tb.size - inter)
  // все слова одного названия есть в другом
  const subset = inter && inter === Math.min(ta.size, tb.size) ? 0.7 : 0
  const xs = x.replace(/ /g, '')
  const ys = y.replace(/ /g, '')
  const letters = 1 - levenshtein(xs, ys) / Math.max(xs.length, ys.length)
  return Math.max(jaccard, subset, letters)
}

/** Проект с написаниями, по которым его узнают в Consum. */
export interface NamedProject {
  /** Основное название. */
  name: string
  /** Другие написания. */
  aliases?: string[]
}

/** Как найден проект: точно по имени/алиасу или без учёта года, регистра и знаков. */
export type ProjectMatchKind = 'exact' | 'auto'

/** Найденный проект. */
export interface ProjectMatch<P extends NamedProject> {
  project: P
  how: ProjectMatchKind
}

/** Находит проект программы по названию из Consum. */
export function matchProject<P extends NamedProject>(raw: unknown, projects: readonly P[]): ProjectMatch<P> | null {
  const k = nameKey(raw)
  const pk = projectKey(raw)
  if (!k) return null
  for (const p of projects) if ([p.name, ...(p.aliases ?? [])].some((n) => nameKey(n) === k)) return { project: p, how: 'exact' }
  if (pk) for (const p of projects) if ([p.name, ...(p.aliases ?? [])].some((n) => projectKey(n) === pk)) return { project: p, how: 'auto' }
  return null
}

/** Лучшее предположение из списка названий (для подсказок). */
export function bestMatch(raw: unknown, names: readonly string[], normalize: (text: unknown) => string = projectKey, min = 0.62): { name: string; score: number } | null {
  let best: { name: string; score: number } | null = null
  for (const name of names) {
    const score = similarity(raw, name, normalize)
    if (score >= min && (!best || score > best.score)) best = { name, score }
  }
  return best
}

/** Допустимое имя листа Excel: без \ / ? * [ ] :, до 31 символа. */
export const safeSheetName = (text: unknown): string =>
  String(text ?? '').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31)

/** Обычная строка ячейки: без лишних пробелов. */
export const cleanText = (value: unknown): string => (value == null ? '' : String(value).trim().replace(/\s+/g, ' '))

/** Варианты названия блока: «ST_100.110» → {«ST_100.110», «ST_100», «ST_110»}. */
export function titleTokens(title: unknown): Set<string> {
  const t = cleanText(title).toUpperCase().replace(/["'“”]/g, '')
  const out = new Set([t])
  const parts = t.split('.')
  if (parts.length > 1) {
    const prefix = parts[0]!.replace(/\d+$/, '')
    out.add(parts[0]!)
    for (const p of parts.slice(1)) if (/^\d+$/.test(p)) out.add(prefix + p)
  }
  return out
}

/** Есть ли у двух наборов общий элемент. */
export const intersects = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => [...a].some((x) => b.has(x))

/** Буквы ID элементов, которые программа подбирает по названию проекта: «NORD INFRA» → «NI». */
export function autoIdPrefix(project: string): string {
  const words = cleanText(project).toUpperCase().replace(/[^A-ZА-Я0-9 ]/g, ' ').split(' ').filter(Boolean)
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] || 'XX').slice(0, 2)).replace(/[^A-Z]/g, 'X').padEnd(2, 'X')
}

/** Буквы ID проекта: заданные вручную (1–3 латинские) или подобранные по названию. */
export function idPrefix(project: string, manual?: string): string {
  const own = manual?.toUpperCase().replace(/[^A-Z]/g, '')
  if (own && own.length >= 1) return own.slice(0, 3).padEnd(2, 'X')
  return autoIdPrefix(project)
}
