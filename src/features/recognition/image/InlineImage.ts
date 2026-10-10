import { RecognitionError } from '../RecognitionError'
import { IMAGE_SIGNATURE_BYTES, PROVIDER_IMAGE_TYPES, sniffImageType } from './imageType'
import { analyzePhoto, type PhotoIssue } from './PhotoQuality'

/** Параметры `InlineImage.fromUrl`. */
export interface InlineImageOptions {
  /**
   * Уменьшить так, чтобы длинная сторона была не больше стольки пикселей; `null` — без уменьшения.
   * Фото с телефона — 12+ Мп; изображение поменьше загружается быстрее и стоит меньше токенов.
   */
  maxSide: number | null
}

/** Качество JPEG при уменьшении и перекодировании изображения. */
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
   * Тип берётся из ответа, а если его там нет (фото из галереи Android) — по первым байтам файла. Формат,
   * который принимают не все провайдеры (HEIC, GIF, BMP…), перекодируется в JPEG, если платформа его декодирует.
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
    const type = blob.type.startsWith('image/')
      ? blob.type
      : sniffImageType(new Uint8Array(await blob.slice(0, IMAGE_SIGNATURE_BYTES).arrayBuffer()))

    // Фото декодируется один раз: для локальной проверки качества и для уменьшения.
    let bitmap: ImageBitmap | null = null
    try {
      bitmap = await createImageBitmap(blob)
    } catch {
      // Платформа не декодирует формат (например, HEIC в WebView Android) — отправим как есть, без проверки.
    }
    if (!type && !bitmap) throw new RecognitionError('notAnImage')
    try {
      const issues = bitmap ? analyzePhoto(bitmap) : []
      const prepared = bitmap ? await InlineImage.prepare(blob, type, bitmap, maxSide) : blob
      const dataUrl = await InlineImage.readAsDataUrl(prepared)
      const mimeType = prepared === blob ? (type ?? 'image/jpeg') : prepared.type || 'image/jpeg'
      return new InlineImage(mimeType, dataUrl.slice(dataUrl.indexOf(',') + 1), issues)
    } finally {
      bitmap?.close()
    }
  }

  /**
   * Готовит декодированное фото к отправке: перекодирует в JPEG с длинной стороной не больше `maxSide`
   * (`null` — без уменьшения). Исходный blob остаётся, если он уже достаточно мал и его формат принимают
   * все провайдеры (`PROVIDER_IMAGE_TYPES`), а также если перекодировать не удалось.
   * `createImageBitmap` применяет ориентацию EXIF, поэтому повёрнутые фото с телефона остаются ровными.
   */
  private static async prepare(blob: Blob, type: string | null, bitmap: ImageBitmap, maxSide: number | null): Promise<Blob> {
    const scale = maxSide === null ? 1 : Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    if (scale >= 1 && type !== null && PROVIDER_IMAGE_TYPES.has(type)) return blob

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const encoded = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    return encoded ?? blob
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
