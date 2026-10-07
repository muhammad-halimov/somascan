import { RecognitionError } from '../RecognitionError'
import { analyzePhoto, type PhotoIssue } from './PhotoQuality'

/** Параметры `InlineImage.fromUrl`. */
export interface InlineImageOptions {
  /**
   * Уменьшить так, чтобы длинная сторона была не больше стольки пикселей; `null` оставляет оригинал.
   * Фото с телефона — 12+ Мп; изображение поменьше загружается быстрее и стоит меньше токенов.
   */
  maxSide: number | null
}

/** Качество JPEG при уменьшении изображения. */
const JPEG_QUALITY = 0.9

/** Байты изображения, готовые для вставки в запрос к провайдеру (base64 без префикса `data:`). */
export class InlineImage {
  /** MIME-тип, например `image/jpeg`. */
  readonly mimeType: string
  /** Байты в кодировке Base64. */
  readonly data: string
  /** Проблемы, найденные локальной проверкой фото (размытие, темнота, пересвет). */
  readonly issues: readonly PhotoIssue[]

  /**
   * @param mimeType MIME-тип байтов.
   * @param data Байты в кодировке Base64.
   * @param issues Проблемы фото по локальной проверке.
   */
  constructor(mimeType: string, data: string, issues: readonly PhotoIssue[] = []) {
    this.mimeType = mimeType
    this.data = data
    this.issues = issues
  }

  /** `data:` URL в том виде, в каком его ждут OpenAI-совместимые API. */
  get dataUrl() {
    return `data:${this.mimeType};base64,${this.data}`
  }

  /**
   * Загружает выбранное фото (URL вида `blob:`, `capacitor://` или `http(s):`) и при необходимости уменьшает его.
   * @throws {RecognitionError} `imageUnreadable` или `notAnImage`.
   */
  static async fromUrl(url: string, { maxSide }: InlineImageOptions): Promise<InlineImage> {
    let blob: Blob
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      blob = await response.blob()
    } catch (error) {
      throw new RecognitionError('imageUnreadable', { detail: error instanceof Error ? error.message : String(error) })
    }
    if (!blob.type.startsWith('image/')) throw new RecognitionError('notAnImage')

    // Фото декодируется один раз: для локальной проверки качества и для уменьшения.
    let bitmap: ImageBitmap | null = null
    try {
      bitmap = await createImageBitmap(blob)
    } catch {
      // Платформа не декодирует формат (например, HEIC в браузере) — отправим как есть, без проверки.
    }
    try {
      const issues = bitmap ? analyzePhoto(bitmap) : []
      const prepared = maxSide === null || !bitmap ? blob : await InlineImage.downscale(blob, bitmap, maxSide)
      const dataUrl = await InlineImage.readAsDataUrl(prepared)
      return new InlineImage(prepared.type || 'image/jpeg', dataUrl.slice(dataUrl.indexOf(',') + 1), issues)
    } finally {
      bitmap?.close()
    }
  }

  /**
   * Перекодирует изображение в JPEG с длинной стороной не больше `maxSide`.
   * Возвращает исходный blob, если он уже достаточно мал.
   * `createImageBitmap` применяет ориентацию EXIF, поэтому повёрнутые фото с телефона остаются ровными.
   */
  private static async downscale(blob: Blob, bitmap: ImageBitmap, maxSide: number): Promise<Blob> {
    const scale = maxSide / Math.max(bitmap.width, bitmap.height)
    if (scale >= 1) return blob

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const resized = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    return resized ?? blob
  }

  /** Читает blob как `data:` URL. */
  private static readAsDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      const fail = () => reject(new RecognitionError('imageUnreadable'))
      reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : fail())
      reader.onerror = fail
      reader.readAsDataURL(blob)
    })
  }
}
