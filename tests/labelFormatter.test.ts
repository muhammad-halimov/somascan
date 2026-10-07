/**
 * Показ значений бирки: единицы после чисел переводятся на язык интерфейса, коды не трогаются.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LabelFormatter } from '../src/features/recognition/label/LabelFormatter'

const ru = new LabelFormatter({ notRecognized: 'Не распознано', weightUnit: 'кг', lengthUnit: 'мм' })

test('миллиметры и килограммы переводятся, коды — нет', () => {
  assert.equal(ru.value('code', '10 mm'), '10 мм')
  assert.equal(ru.value('code', 'Ø12MM'), 'Ø12 мм')
  assert.equal(ru.value('weight', 2140), '2140 кг')
  assert.equal(ru.value('weight', '2140 Kg'), '2140 кг')
  assert.equal(ru.value('code', 'B500C'), 'B500C')
  assert.equal(ru.value('code', 'mm-25'), 'mm-25', 'без числа перед единицей — как есть')
  assert.equal(ru.value('code', null), 'Не распознано')
})

test('правка: у размера и веса только число, без R, Ø и единиц; в просмотре — с единицами', () => {
  assert.equal(ru.editValue('code', 'R20', 'size'), '20')
  assert.equal(ru.editValue('code', '10 mm', 'size'), '10')
  assert.equal(ru.editValue('code', 'Ø 12мм', 'size'), '12')
  assert.equal(ru.editValue('code', '8/7', 'size'), '8/7', 'не одно число — как есть')
  assert.equal(ru.editValue('weight', '2140 kg'), '2140')
  assert.equal(ru.editValue('weight', 2140), '2140')
  assert.equal(ru.editValue('code', 'B500C', 'grade'), 'B500C')
  assert.equal(ru.editValue('code', null, 'size'), '')
  assert.equal(ru.value('code', '20', 'size'), '20 мм', 'число после правки в просмотре — с миллиметрами')
  assert.equal(ru.value('code', 'R20', 'size'), 'R20', 'пометка с бирки в просмотре остаётся')
  assert.equal(ru.value('code', '20', 'heat'), '20', 'у других полей единица не добавляется')
})
