/**
 * Строки страницы на ровной сетке: рамки выпрямлены по общему наклону бирки (фото под углом)
 * и выражены в долях высоты фото, чтобы расстояния по горизонтали и вертикали были сравнимы.
 * Отсюда — «справа в той же строке» и «сразу под подписью», по которым значения находят свои подписи.
 */
import { foldWithMap, type FoldedText } from './foldText'
import type { OcrPage } from './ocrTypes'

/** Рамка строки на выпрямленной странице; единица — высота фото. */
export interface LineBox {
  left: number
  top: number
  right: number
  bottom: number
}

/** Строка, готовая к разбору. */
export interface PageLine {
  /** Номер строки на странице. */
  index: number
  /** Текст. */
  text: string
  /** Текст в сложенном виде (поиск подписей). */
  folded: FoldedText
  /** Уверенность OCR 0…1; `null` — неизвестна. */
  confidence: number | null
  /** Рамка; у строк из кодов (QR, DataMatrix) её нет, в соседстве они не участвуют. */
  box: LineBox | null
}

/** Высота рамки. */
export const boxHeight = (box: LineBox) => box.bottom - box.top

/** Наклон бирки больше этого (радианы, ~30°) — не наклон, а ошибка движка: не выпрямляем. */
const MAX_SKEW = Math.PI / 6

/** Наклон меньше этого (радианы, ~0,3°) не стоит выпрямления. */
const MIN_SKEW = 0.005

/** Наклон строки по её верхней кромке (радианы, по часовой стрелке положительный) и длина кромки. */
function topEdge(corners: readonly number[]) {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = corners
  return { angle: Math.atan2(y1 - y0, x1 - x0), length: Math.hypot(x1 - x0, y1 - y0) }
}

/**
 * Общий наклон бирки — взвешенная по длине медиана наклонов строк (длинные строки точнее,
 * а одиночные кривые рамки — например, логотипы — медиану не сдвигают).
 */
function pageSkew(lines: ReadonlyArray<{ text: string; corners: readonly number[] }>): number {
  const edges = lines
    .filter((line) => line.corners.length >= 8 && line.text.trim().length >= 3)
    .map((line) => topEdge(line.corners))
    .filter((edge) => edge.length > 0 && Math.abs(edge.angle) < MAX_SKEW)
    .sort((a, b) => a.angle - b.angle)
  const total = edges.reduce((sum, edge) => sum + edge.length, 0)
  let passed = 0
  for (const edge of edges) {
    passed += edge.length
    if (passed >= total / 2) return Math.abs(edge.angle) < MIN_SKEW ? 0 : edge.angle
  }
  return 0
}

/** Точка, повёрнутая на `turns` четвертей оборота против часовой стрелки (на экране, где y растёт вниз). */
function turnPoint(x: number, y: number, turns: number): [number, number] {
  switch (((turns % 4) + 4) % 4) {
    case 1: return [y, -x]
    case 2: return [-x, -y]
    case 3: return [-y, x]
    default: return [x, y]
  }
}

/**
 * Строки страницы с выпрямленными рамками. Пустые строки и строки без рамки пропускаются.
 * @param page Текст фото в одном повороте.
 * @param turns На сколько четвертей оборота повернуть координаты строк, прежде чем выпрямлять: движок мог
 *   прочесть повёрнутую бирку и отдать рамки боком или вверх ногами (и в своих координатах) — какой поворот
 *   верный, решает разбор (`extractLabel` пробует все четыре).
 */
export function layoutPage(page: OcrPage, turns = 0): PageLine[] {
  const scale = page.height > 0 ? page.height : 1
  const turned = page.lines.map((line) => ({
    ...line,
    corners: line.corners.length < 8 ? line.corners : [0, 1, 2, 3].flatMap((point) => turnPoint(line.corners[point * 2]!, line.corners[point * 2 + 1]!, turns)),
  }))
  const skew = pageSkew(turned)
  const cos = Math.cos(-skew)
  const sin = Math.sin(-skew)
  const lines: PageLine[] = []
  for (const line of turned) {
    const text = line.text.replace(/\s+/g, ' ').trim()
    if (!text || line.corners.length < 8) continue
    const xs: number[] = []
    const ys: number[] = []
    for (let point = 0; point < 4; point++) {
      const x = line.corners[point * 2]! / scale
      const y = line.corners[point * 2 + 1]! / scale
      xs.push(x * cos - y * sin)
      ys.push(x * sin + y * cos)
    }
    lines.push({
      index: lines.length,
      text,
      folded: foldWithMap(text),
      confidence: line.confidence,
      box: { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) },
    })
  }
  return lines
}

/** Медианная высота строк страницы (типичный размер шрифта); `fallback`, если строк нет. */
export function typicalLineHeight(lines: readonly PageLine[], fallback = 0.03): number {
  const heights = lines.flatMap((line) => (line.box ? [boxHeight(line.box)] : [])).sort((a, b) => a - b)
  return heights.length > 0 ? heights[Math.floor(heights.length / 2)]! : fallback
}

/** Насколько строки перекрываются по вертикали: доля высоты меньшей из них (0 — не перекрываются). */
export function rowOverlap(a: LineBox, b: LineBox): number {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return overlap <= 0 ? 0 : overlap / Math.max(1e-6, Math.min(boxHeight(a), boxHeight(b)))
}

/** Строки на одном уровне — одна строка таблицы бирки. */
export const sameRow = (a: LineBox, b: LineBox) => rowOverlap(a, b) >= 0.45

/** `value` в той же строке, правее подписи `label`. */
export const isRightOf = (label: LineBox, value: LineBox) =>
  sameRow(label, value) && value.left >= label.left + (label.right - label.left) * 0.6

/**
 * `value` сразу под подписью `label`: начинается ниже середины подписи, не дальше чем через строку,
 * и перекрывает её по горизонтали.
 * @param lineHeight Типичная высота строки страницы.
 */
export function isBelow(label: LineBox, value: LineBox, lineHeight: number): boolean {
  const height = Math.max(boxHeight(label), lineHeight)
  const gap = value.top - label.bottom
  return value.top >= label.top + boxHeight(label) * 0.6
    && gap <= height * 1.3
    && value.left < label.right
    && value.right > label.left - height * 0.5
}
