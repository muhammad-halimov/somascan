/**
 * Подпись лаборанта: прозрачный фон обязателен, прозрачные поля вокруг подписи обрезаются.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contentBox, hasTransparency } from '../src/host/signatureImage'

/** Изображение `width × height`: прозрачное, кроме непрозрачного прямоугольника. */
function image(width: number, height: number, ink?: { x: number; y: number; width: number; height: number }, background = 0): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = ink && x >= ink.x && x < ink.x + ink.width && y >= ink.y && y < ink.y + ink.height
      out[(y * width + x) * 4 + 3] = inside ? 255 : background
    }
  }
  return out
}

test('прозрачный фон: есть хоть один прозрачный пиксель; фото без прозрачности — нет', () => {
  assert.equal(hasTransparency(image(4, 4, { x: 1, y: 1, width: 2, height: 2 })), true)
  assert.equal(hasTransparency(image(4, 4, undefined, 255)), false)
})

test('подпись внизу большого прозрачного поля: обрезается до неё с небольшим полем', () => {
  // 480 × 270, подпись — полоса 400 × 50 внизу (как «Signature» у нижнего края)
  assert.deepEqual(contentBox(image(480, 270, { x: 40, y: 200, width: 400, height: 50 }), 480, 270), { x: 24, y: 184, width: 432, height: 82 })
  // поле не выходит за края изображения
  assert.deepEqual(contentBox(image(10, 10, { x: 0, y: 0, width: 10, height: 10 }), 10, 10), { x: 0, y: 0, width: 10, height: 10 })
  // почти прозрачная «тень» сжатия — фон
  assert.equal(contentBox(image(8, 8, undefined, 6), 8, 8), null)
})
