/**
 * Байты ↔ base64.
 *
 * Мост Capacitor передаёт только JSON, поэтому содержимое файлов (таблица `.xlsx`) ходит между
 * веб-частью и нативными плагинами строкой base64. Кодирование идёт кусками:
 * `String.fromCharCode` с сотнями тысяч аргументов переполняет стек вызовов.
 */

/** Сколько байтов превращается в строку за один вызов `fromCharCode`. */
const CHUNK = 0x8000

/** Кодирует байты в base64 (без переносов строк). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}

/** Декодирует base64 в байты. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Строка → байты UTF-8. */
export const utf8ToBytes = (text: string): Uint8Array => new TextEncoder().encode(text)

/** Байты UTF-8 → строка. */
export const bytesToUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
