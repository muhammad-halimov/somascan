/**
 * Качество фото бирки: что мешает прочитать текст и что стоит исправить при пересъёмке.
 *
 * Оценка двойная. Модель видит фото и сообщает о бликах, обрезанной бирке, сильном наклоне и т. п.
 * (ключ `_photo` в ответе — см. `labelPrompt`). Локальная проверка по пикселям ловит только явные
 * случаи — сильное размытие, темноту и пересвет, — с осторожными порогами, чтобы не мешать ложными
 * предупреждениями (пороги подобраны на фото бирок и на скриншотах тёмной темы).
 */

/** Проблема фото. Для каждой есть подпись в `locales/<язык>/workspace.json` (`photoIssues`). */
export type PhotoIssue =
  /** Не в фокусе или смазано движением. */
  | 'blurry'
  /** Блик или вспышка закрывает текст. */
  | 'glare'
  /** Слишком темно. */
  | 'dark'
  /** Пересвечено. */
  | 'overexposed'
  /** Часть бирки за краем кадра. */
  | 'cropped'
  /** Сильный наклон или перспектива. */
  | 'angle'
  /** Бирка слишком мелкая в кадре. */
  | 'far'
  /** Текст закрыт посторонним (пальцы, предметы, тень). */
  | 'obstructed'
  /** На фото нет бирки. */
  | 'noTag'

/** Все проблемы в порядке показа. */
export const PHOTO_ISSUES: readonly PhotoIssue[] = ['noTag', 'blurry', 'glare', 'dark', 'overexposed', 'cropped', 'angle', 'far', 'obstructed']

/** Проверка, что значение — известная проблема фото. */
export const isPhotoIssue = (value: unknown): value is PhotoIssue =>
  typeof value === 'string' && (PHOTO_ISSUES as readonly string[]).includes(value)

/** Длинная сторона уменьшенной копии для анализа: быстро и достаточно для оценки резкости. */
const ANALYSIS_SIDE = 512

/** Ниже этой дисперсии лапласиана фото считается размытым (резкое фото бирки — тысячи, сильно смазанное — единицы). */
const BLUR_VARIANCE = 40

/** Если даже самые светлые 1 % пикселей темнее этого — фото тёмное (у скриншотов тёмной темы светлый текст, они проходят). */
const DARK_P99 = 70

/** Если светлее этого больше половины кадра, а тени (5-й процентиль) почти белые — фото пересвечено. */
const BRIGHT_LEVEL = 245
const BRIGHT_SHARE = 0.5
const OVEREXPOSED_P5 = 200

/** Яркость пикселя (Rec. 601). */
const luma = (r: number, g: number, b: number) => (r * 299 + g * 587 + b * 114) / 1000

/** Перцентиль `p` (0…1) по гистограмме яркости. */
function percentile(histogram: Uint32Array, total: number, p: number): number {
  const target = total * p
  let sum = 0
  for (let level = 0; level < histogram.length; level++) {
    sum += histogram[level]!
    if (sum >= target) return level
  }
  return histogram.length - 1
}

/**
 * Локальная проверка фото по пикселям: размытие, темнота, пересвет.
 * @param source Декодированное изображение (с учётом ориентации EXIF).
 * @returns Найденные проблемы; пустой список, если всё в порядке или анализ недоступен.
 */
export function analyzePhoto(source: ImageBitmap): PhotoIssue[] {
  const scale = Math.min(1, ANALYSIS_SIDE / Math.max(source.width, source.height))
  const width = Math.max(3, Math.round(source.width * scale))
  const height = Math.max(3, Math.round(source.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return []
  context.drawImage(source, 0, 0, width, height)
  let pixels: Uint8ClampedArray
  try {
    pixels = context.getImageData(0, 0, width, height).data
  } catch {
    return []
  }

  const gray = new Float32Array(width * height)
  const histogram = new Uint32Array(256)
  for (let index = 0; index < gray.length; index++) {
    const value = luma(pixels[index * 4]!, pixels[index * 4 + 1]!, pixels[index * 4 + 2]!)
    gray[index] = value
    histogram[Math.min(255, Math.round(value))]!++
  }

  // Резкость: дисперсия лапласиана (4-связного) по внутренним пикселям.
  let sum = 0
  let sumSquares = 0
  let count = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const at = y * width + x
      const laplacian = gray[at - 1]! + gray[at + 1]! + gray[at - width]! + gray[at + width]! - 4 * gray[at]!
      sum += laplacian
      sumSquares += laplacian * laplacian
      count++
    }
  }
  const mean = sum / count
  const variance = sumSquares / count - mean * mean

  const total = gray.length
  let bright = 0
  for (let level = BRIGHT_LEVEL; level < 256; level++) bright += histogram[level]!

  const issues: PhotoIssue[] = []
  if (variance < BLUR_VARIANCE) issues.push('blurry')
  if (percentile(histogram, total, 0.99) < DARK_P99) issues.push('dark')
  if (bright / total > BRIGHT_SHARE && percentile(histogram, total, 0.05) > OVEREXPOSED_P5) issues.push('overexposed')
  return issues
}

/** Объединяет списки проблем без повторов, в порядке `PHOTO_ISSUES`. */
export const mergePhotoIssues = (...lists: ReadonlyArray<readonly PhotoIssue[]>): PhotoIssue[] =>
  PHOTO_ISSUES.filter((issue) => lists.some((list) => list.includes(issue)))
