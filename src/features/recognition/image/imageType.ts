/**
 * Тип изображения по первым байтам файла. Нужен там, где тип из ответа неизвестен: фото из галереи Android
 * (`content://`) WebView отдаёт без Content-Type, и сам угадывает только JPEG, PNG, GIF и WebP — HEIC
 * приходит как `application/octet-stream`.
 */

/** Сколько первых байтов нужно `sniffImageType`. */
export const IMAGE_SIGNATURE_BYTES = 16

/** Типы, которые принимают все провайдеры распознавания; остальные перекодируются в JPEG. */
export const PROVIDER_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** Марки контейнера ISO BMFF (`ftyp`) и их типы. */
const FTYP_BRANDS: Readonly<Record<string, string>> = {
  heic: 'image/heic',
  heix: 'image/heic',
  heim: 'image/heic',
  heis: 'image/heic',
  hevc: 'image/heic',
  hevx: 'image/heic',
  mif1: 'image/heif',
  msf1: 'image/heif',
  heif: 'image/heif',
  avif: 'image/avif',
  avis: 'image/avif',
}

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))

const startsWith = (bytes: Uint8Array, signature: readonly number[]) => signature.every((byte, index) => bytes[index] === byte)

/**
 * Тип изображения по сигнатуре.
 * @param head Первые байты файла (хватит `IMAGE_SIGNATURE_BYTES`).
 * @returns MIME-тип или `null`, если это не известный формат изображения.
 */
export function sniffImageType(head: Uint8Array): string | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') return 'image/gif'
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'image/webp'
  if (ascii(head, 4, 8) === 'ftyp') return FTYP_BRANDS[ascii(head, 8, 12)] ?? null
  if (ascii(head, 0, 2) === 'BM') return 'image/bmp'
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) return 'image/tiff'
  return null
}
