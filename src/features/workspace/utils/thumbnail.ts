/** Длинная сторона миниатюры для сетки, px (ячейка ~120 точек при плотности экрана 3). */
const THUMBNAIL_SIDE = 360

/** Качество JPEG миниатюры. */
const JPEG_QUALITY = 0.8

/** Миниатюры строятся по одной: у каждого фото с телефона целиком декодируется 12+ Мп. */
let queue: Promise<unknown> = Promise.resolve()

/** Миниатюра и натуральный размер фото (с учётом ориентации EXIF). */
export interface Thumbnail {
  url: string
  width: number
  height: number
}

/**
 * Уменьшенная копия фото для сетки (`blob:`). Сетка из девяти полноразмерных фото заняла бы
 * в WebView сотни мегабайт: картинка декодируется целиком, даже если показана маленькой.
 * `createImageBitmap` применяет ориентацию EXIF — миниатюра повёрнута так же, как фото.
 * @returns Миниатюра или `null`, если платформа не декодирует формат (сетка покажет само фото).
 */
export function makeThumbnail(url: string): Promise<Thumbnail | null> {
  const task = queue.then(async () => {
    try {
      const response = await fetch(url)
      const bitmap = await createImageBitmap(await response.blob())
      try {
        const scale = Math.min(1, THUMBNAIL_SIDE / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
        return blob ? { url: URL.createObjectURL(blob), width: bitmap.width, height: bitmap.height } : null
      } finally {
        bitmap.close()
      }
    } catch {
      return null
    }
  })
  queue = task
  return task
}
