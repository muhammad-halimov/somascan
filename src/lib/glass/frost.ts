/**
 * «Матовое стекло» на снимке экрана: то же, что делает `backdrop-filter: saturate(…) blur(…)`, но один раз
 * над пикселями снимка (RGBA), а не на каждом кадре в GPU.
 */

/** Шаг фильтра стекла в порядке записи в CSS: насыщенность (1 — без изменений) или размытие (радиус, CSS px). */
export type GlassStep = { kind: 'saturate'; amount: number } | { kind: 'blur'; radius: number }

/** Функция фильтра CSS: имя и аргумент. */
const FILTER_FUNCTION = /\s*([a-z-]+)\(\s*([^)]*?)\s*\)\s*/y

/**
 * Разбирает значение `backdrop-filter` (`saturate(190%) blur(26px)`). Понимает только `saturate()` и `blur()`:
 * другое снимок не повторит — тогда null, и окно остаётся на живом размытии.
 */
export function parseGlassFilter(value: string): GlassStep[] | null {
  const text = value.trim()
  if (!text || text === 'none') return null
  const steps: GlassStep[] = []
  FILTER_FUNCTION.lastIndex = 0
  while (FILTER_FUNCTION.lastIndex < text.length) {
    const match = FILTER_FUNCTION.exec(text)
    if (!match) return null
    const [, name, argument] = match
    if (name === 'saturate') {
      const amount = argument!.endsWith('%') ? Number.parseFloat(argument!) / 100 : Number(argument)
      if (!Number.isFinite(amount) || amount < 0) return null
      steps.push({ kind: 'saturate', amount })
    } else if (name === 'blur') {
      const radius = argument === '0' ? 0 : argument!.endsWith('px') ? Number.parseFloat(argument!) : Number.NaN
      if (!Number.isFinite(radius) || radius < 0) return null
      steps.push({ kind: 'blur', radius })
    } else {
      return null
    }
  }
  return steps
}

/**
 * Насыщенность, как у `saturate()` в CSS (матрица `feColorMatrix type="saturate"` из Filter Effects), с отсечением
 * в 0…255. Прозрачность не трогает.
 */
export function saturatePixels(pixels: Uint8ClampedArray, amount: number) {
  const s = amount
  const rr = 0.213 + 0.787 * s, rg = 0.715 - 0.715 * s, rb = 0.072 - 0.072 * s
  const gr = 0.213 - 0.213 * s, gg = 0.715 + 0.285 * s, gb = 0.072 - 0.072 * s
  const br = 0.213 - 0.213 * s, bg = 0.715 - 0.715 * s, bb = 0.072 + 0.928 * s
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!
    pixels[i] = rr * r + rg * g + rb * b
    pixels[i + 1] = gr * r + gg * g + gb * b
    pixels[i + 2] = br * r + bg * g + bb * b
  }
}

/** Сколько проходов прямоугольного размытия заменяют гауссово: после трёх разница на глаз не видна. */
const BOX_PASSES = 3

/**
 * Ширины прямоугольных размытий (нечётные), которые вместе дают гауссово с отклонением `sigma`, px
 * (сумма дисперсий проходов равна `sigma²`).
 */
export function boxWidthsForGauss(sigma: number, passes = BOX_PASSES): number[] {
  const ideal = Math.sqrt((12 * sigma * sigma) / passes + 1)
  let lower = Math.floor(ideal)
  if (lower % 2 === 0) lower -= 1
  const upper = lower + 2
  const lowerCount = Math.round((12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) / (-4 * lower - 4))
  return Array.from({ length: passes }, (_, index) => (index < lowerCount ? lower : upper))
}

/**
 * Прямоугольное размытие радиуса `radius` одного канала (`source` → `target`) вдоль `lines` линий длиной `length`:
 * соседние точки линии через `step`, линии через `lineStep` (строки: 1 и ширина, столбцы: ширина и 1). Скользящей
 * суммой — без зависимости от радиуса; за краем снимка повторяется крайняя точка.
 */
function boxBlurLines(source: Float32Array, target: Float32Array, lines: number, lineStep: number, length: number, step: number, radius: number) {
  const scale = 1 / (radius * 2 + 1)
  const last = length - 1
  for (let line = 0; line < lines; line++) {
    const start = line * lineStep
    const first = source[start]!
    const end = source[start + last * step]!
    let sum = (radius + 1) * first
    for (let index = 1; index <= radius; index++) sum += source[start + Math.min(index, last) * step]!
    for (let index = 0; index < length; index++) {
      target[start + index * step] = sum * scale
      const added = index + radius + 1
      const removed = index - radius
      sum += (added <= last ? source[start + added * step]! : end) - (removed >= 0 ? source[start + removed * step]! : first)
    }
  }
}

/** Гауссово размытие с отклонением `sigma`, px — тремя прямоугольными по строкам и столбцам, по каналу за раз. */
export function blurPixels(pixels: Uint8ClampedArray, width: number, height: number, sigma: number) {
  if (sigma <= 0 || width === 0 || height === 0) return
  const radii = boxWidthsForGauss(sigma).map((boxWidth) => (boxWidth - 1) / 2).filter((radius) => radius >= 1)
  const count = width * height
  const channel = new Float32Array(count)
  const scratch = new Float32Array(count)
  for (let offset = 0; offset < 3; offset++) {
    for (let index = 0; index < count; index++) channel[index] = pixels[index * 4 + offset]!
    for (const radius of radii) {
      boxBlurLines(channel, scratch, height, width, width, 1, radius)
      boxBlurLines(scratch, channel, width, 1, height, width, radius)
    }
    for (let index = 0; index < count; index++) pixels[index * 4 + offset] = channel[index]!
  }
}

/**
 * Делает снимок экрана стеклом: шаги фильтра по порядку. `scale` — пикселей снимка на CSS-пиксель
 * (радиус размытия в CSS задан в CSS-пикселях).
 */
export function frostPixels(pixels: Uint8ClampedArray, width: number, height: number, steps: readonly GlassStep[], scale: number) {
  for (const step of steps) {
    if (step.kind === 'saturate') saturatePixels(pixels, step.amount)
    else blurPixels(pixels, width, height, step.radius * scale)
  }
}
