/**
 * MD5 байтов в hex — для сверки с `md5Checksum`, который Google Drive возвращает после загрузки файла.
 * Web Crypto MD5 не поддерживает, поэтому здесь компактная реализация по RFC 1321.
 * Для защиты данных MD5 не годится; здесь он только проверяет, что файл дошёл без искажений.
 */

/** Сдвиги по раундам. */
const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]

/** Константы K[i] = floor(|sin(i + 1)| · 2^32). */
const K = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32) >>> 0)

/** Циклический сдвиг влево. */
const rotl = (value: number, count: number) => (value << count) | (value >>> (32 - count))

/** MD5 байтов в виде 32 hex-символов в нижнем регистре. */
export function md5Hex(bytes: Uint8Array): string {
  const bitLength = bytes.length * 8
  const paddedLength = (((bytes.length + 8) >>> 6) + 1) << 6
  const data = new Uint8Array(paddedLength)
  data.set(bytes)
  data[bytes.length] = 0x80
  const view = new DataView(data.buffer)
  view.setUint32(paddedLength - 8, bitLength >>> 0, true)
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 2 ** 32), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476
  const words = new Uint32Array(16)

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4, true)
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let index = 0; index < 64; index++) {
      let f: number
      let g: number
      if (index < 16) {
        f = (b & c) | (~b & d)
        g = index
      } else if (index < 32) {
        f = (d & b) | (~d & c)
        g = (5 * index + 1) % 16
      } else if (index < 48) {
        f = b ^ c ^ d
        g = (3 * index + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * index) % 16
      }
      const next = d
      d = c
      c = b
      b = (b + rotl((a + f + K[index]! + words[g]!) >>> 0, SHIFTS[(index >>> 4) * 4 + (index % 4)]!)) >>> 0
      a = next
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }

  const out = new DataView(new ArrayBuffer(16))
  ;[a0, b0, c0, d0].forEach((word, index) => out.setUint32(index * 4, word, true))
  return Array.from(new Uint8Array(out.buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
