/**
 * Неподвижное стекло окон: снимок экрана размывается тем же фильтром, что живое `backdrop-filter` в CSS, —
 * разбор фильтра, насыщенность (матрица CSS `saturate()`) и гауссово размытие тремя прямоугольными.
 * Запуск: `npm test`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { blurPixels, boxWidthsForGauss, frostPixels, parseGlassFilter, saturatePixels } from '../src/lib/glass/frost'

/** Картинка `width` × `height` одного цвета (непрозрачная). */
function solid(width: number, height: number, [r, g, b]: [number, number, number]) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < pixels.length; index += 4) pixels.set([r, g, b, 255], index)
  return pixels
}

test('фильтр стекла разбирается по шагам в порядке записи', () => {
  assert.deepEqual(parseGlassFilter('saturate(190%) blur(26px)'), [{ kind: 'saturate', amount: 1.9 }, { kind: 'blur', radius: 26 }])
  assert.deepEqual(parseGlassFilter(' blur(10px)  saturate(1.8) '), [{ kind: 'blur', radius: 10 }, { kind: 'saturate', amount: 1.8 }])
  assert.deepEqual(parseGlassFilter('blur(0)'), [{ kind: 'blur', radius: 0 }])
})

test('фильтр, который снимок не повторит, не разбирается — окно остаётся на живом размытии', () => {
  assert.equal(parseGlassFilter(''), null)
  assert.equal(parseGlassFilter('none'), null)
  assert.equal(parseGlassFilter('blur(26px) brightness(1.2)'), null)
  assert.equal(parseGlassFilter('blur(2em)'), null)
  assert.equal(parseGlassFilter('saturate(abc)'), null)
})

test('насыщенность: серое остаётся серым, 1 — без изменений, 0 — яркость по формуле CSS', () => {
  const gray = solid(1, 1, [120, 120, 120])
  saturatePixels(gray, 1.9)
  assert.deepEqual([...gray], [120, 120, 120, 255])
  const color = solid(1, 1, [200, 100, 50])
  saturatePixels(color, 1)
  assert.deepEqual([...color], [200, 100, 50, 255])
  saturatePixels(color, 0)
  const luminance = Math.round(0.213 * 200 + 0.715 * 100 + 0.072 * 50)
  assert.deepEqual([...color], [luminance, luminance, luminance, 255])
})

test('насыщенность выше 100 % усиливает цвет и отсекается в 0…255', () => {
  const color = solid(1, 1, [230, 120, 40])
  saturatePixels(color, 1.9)
  assert.equal(color[0], 255)
  assert.ok(color[2]! < 40)
  assert.equal(color[3], 255)
})

test('ширины прямоугольных размытий в сумме дают дисперсию гауссова', () => {
  // Ширины только нечётные: при радиусе стекла (sigma от 4 px снимка) расхождение меньше 10 %.
  for (const sigma of [4, 6.5, 13]) {
    const widths = boxWidthsForGauss(sigma)
    assert.equal(widths.length, 3)
    assert.ok(widths.every((width) => width % 2 === 1))
    const variance = widths.reduce((sum, width) => sum + (width * width - 1) / 12, 0)
    assert.ok(Math.abs(variance - sigma * sigma) / (sigma * sigma) < 0.1, `sigma ${sigma}: ${variance}`)
  }
})

test('размытие однотонного снимка не меняет его', () => {
  const pixels = solid(9, 7, [30, 140, 220])
  blurPixels(pixels, 9, 7, 3)
  assert.deepEqual([...pixels], [...solid(9, 7, [30, 140, 220])])
})

test('размытие точки — симметричное пятно с разбросом sigma', () => {
  const width = 61
  const sigma = 4
  const pixels = solid(width, 1, [0, 0, 0])
  const center = 30
  pixels[center * 4] = 255
  blurPixels(pixels, width, 1, sigma)
  const weights = Array.from({ length: width }, (_, x) => pixels[x * 4]!)
  assert.equal(weights[center - 5], weights[center + 5])
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const variance = weights.reduce((sum, weight, x) => sum + weight * (x - center) ** 2, 0) / total
  assert.ok(Math.abs(Math.sqrt(variance) - sigma) < 0.6, `разброс ${Math.sqrt(variance)}`)
  assert.equal(pixels[3], 255)
})

test('радиус размытия переводится из CSS-пикселей в пиксели снимка', () => {
  const steps = parseGlassFilter('blur(16px)')!
  const direct = solid(41, 1, [0, 0, 0])
  direct[20 * 4 + 1] = 255
  const viaFrost = new Uint8ClampedArray(direct)
  blurPixels(direct, 41, 1, 4)
  frostPixels(viaFrost, 41, 1, steps, 1 / 4)
  assert.deepEqual([...viaFrost], [...direct])
})
