import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { sniffImageType } from '../src/features/recognition/image/imageType'

const bytes = (...parts: Array<number[] | string>) =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === 'string' ? [...part].map((char) => char.charCodeAt(0)) : part)))

test('JPEG, PNG, GIF, WebP, BMP и TIFF узнаются по сигнатуре', () => {
  assert.equal(sniffImageType(bytes([0xff, 0xd8, 0xff, 0xdb])), 'image/jpeg')
  assert.equal(sniffImageType(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a])), 'image/png')
  assert.equal(sniffImageType(bytes('GIF89a')), 'image/gif')
  assert.equal(sniffImageType(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 ')), 'image/webp')
  assert.equal(sniffImageType(bytes('BM', [0, 0, 0, 0])), 'image/bmp')
  assert.equal(sniffImageType(bytes('II*', [0])), 'image/tiff')
})

test('HEIC, HEIF и AVIF — по марке контейнера ftyp', () => {
  assert.equal(sniffImageType(bytes([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0])), 'image/heic')
  assert.equal(sniffImageType(bytes([0, 0, 0, 0x18], 'ftypmif1', [0, 0, 0, 0])), 'image/heif')
  assert.equal(sniffImageType(bytes([0, 0, 0, 0x1c], 'ftypavif', [0, 0, 0, 0])), 'image/avif')
  // Видео в том же контейнере — не изображение.
  assert.equal(sniffImageType(bytes([0, 0, 0, 0x18], 'ftypisom', [0, 0, 0, 0])), null)
})

test('не изображение и пустой файл — null', () => {
  assert.equal(sniffImageType(bytes('<!doctype html>')), null)
  assert.equal(sniffImageType(bytes('%PDF-1.7')), null)
  assert.equal(sniffImageType(new Uint8Array()), null)
})

test('настоящий журнал (.xlsx) — не изображение', () => {
  assert.equal(sniffImageType(new Uint8Array(readFileSync(new URL('./fixtures/Probe otel.xlsx', import.meta.url))).subarray(0, 16)), null)
})
