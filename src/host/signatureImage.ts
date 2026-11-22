/**
 * Пиксели подписи (без Electron — проверяются тестами): есть ли прозрачный фон и где на изображении сама подпись.
 * Изображение — 4 байта на пиксель (BGRA или RGBA), прозрачность — четвёртый.
 */

/** Пиксель с прозрачностью до этой считается фоном (тень сжатия по краям). */
const BACKGROUND_ALPHA = 8

/** Поле вокруг подписи после обрезки, доля от её размера. */
const MARGIN = 0.04

/** Прямоугольник на изображении. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Есть ли прозрачные пиксели. */
export function hasTransparency(bitmap: Uint8Array): boolean {
  for (let i = 3; i < bitmap.length; i += 4) if (bitmap[i]! < 255) return true
  return false
}

/**
 * Где на изображении подпись: прямоугольник непрозрачных пикселей с небольшим полем.
 * @returns `null` — изображение пустое (всё прозрачное).
 */
export function contentBox(bitmap: Uint8Array, width: number, height: number): Box | null {
  let [left, top, right, bottom] = [width, height, -1, -1]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bitmap[(y * width + x) * 4 + 3]! <= BACKGROUND_ALPHA) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right < 0) return null
  const pad = Math.max(2, Math.round(Math.max(right - left, bottom - top) * MARGIN))
  const x = Math.max(0, left - pad)
  const y = Math.max(0, top - pad)
  return { x, y, width: Math.min(width, right + pad + 1) - x, height: Math.min(height, bottom + pad + 1) - y }
}
