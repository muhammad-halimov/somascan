/**
 * Распознавание на устройстве: поля бирки из текста OCR правилами (`LabelExtractor`).
 *
 * Фикстуры `fixtures/ocr/*.json` — настоящий текст с рамками, прочитанный OCR с фото бирок: OAM Ózd
 * (`scripts/screenshots/tag.jpg`) ровно и под наклоном 12°; та же бирка, снятая боком, — прочитанная как есть
 * (строки сверху вниз), повёрнутой правильно и вверх ногами; грязная бирка SOVEL. Остальные бирки собраны из строк в тесте.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DEFAULT_KNOWN_SUPPLIERS } from '../src/features/recognition/label/knownSuppliers'
import { createDefaultLabelFields, enabledLabelFields, recognizedLabelFields, type LabelFieldDefinition } from '../src/features/recognition/label/labelFields'
import { bestExtraction, extractLabel } from '../src/features/recognition/ocr/LabelExtractor'
import type { OcrCode, OcrPage } from '../src/features/recognition/ocr/ocrTypes'
import { matchSupplier } from '../src/features/recognition/ocr/supplierMatch'
import { readDate, readHeat, readSize, readTime, readWeightKg } from '../src/features/recognition/ocr/valueReaders'

/** Все поля, читаемые с фото (включены и выключенные по умолчанию). */
const ALL_FIELDS = createDefaultLabelFields().filter((field) => !field.manual).map((field) => ({ ...field, enabled: true }))

/** Поля по умолчанию: производитель, размер, плавка, вес. */
const DEFAULT_FIELDS = recognizedLabelFields(createDefaultLabelFields())

const fixture = (name: string): OcrPage => JSON.parse(readFileSync(new URL(`./fixtures/ocr/${name}.json`, import.meta.url), 'utf8')) as OcrPage

const extract = (page: OcrPage, fields: readonly LabelFieldDefinition[] = ALL_FIELDS, codes: OcrCode[] = []) =>
  extractLabel({ page, codes, fields, suppliers: DEFAULT_KNOWN_SUPPLIERS })

/** Строка бирки: текст и рамка в долях (x, y — левый верхний угол; высота строки по умолчанию 0,03). */
type Row = [text: string, x: number, y: number, width?: number]

/** Страница 1000×1000 из строк. */
function page(rows: readonly Row[], height = 0.03): OcrPage {
  const size = 1000
  return {
    rotation: 0,
    width: size,
    height: size,
    lines: rows.map(([text, x, y, width = text.length * 0.012]) => {
      const [left, top, right, bottom] = [x * size, y * size, (x + width) * size, (y + height) * size]
      return { text, corners: [left, top, right, top, right, bottom, left, bottom], confidence: 0.9 }
    }),
  }
}

test('бирка OAM Ózd: обязательные поля и остальное с настоящего OCR', () => {
  const { label, photo, score } = extract(fixture('oam-ozd'), ALL_FIELDS, [{ text: '25R00581/2650', format: 'qr' }])
  assert.equal(label.producer, 'OAM Ózdi Acélművek')
  assert.equal(label.size, '12 mm')
  assert.equal(label.heat, '25R00581')
  assert.equal(label.weight_kg, 2650)
  assert.equal(label.grade, 'B500C')
  assert.equal(label.batch, '581')
  assert.equal(label.production_date, '2025-02-12')
  assert.equal(label.mark, '8/7')
  assert.equal(label.product, 'Rebar in Coil/Betonacel tekercs')
  assert.match(String(label.standard), /^HU-Tekercs A-79\/2016; RO-AT016-01\/592-2025; SR-.+; EN-.+$/)
  assert.equal(label.customer_name, null)
  assert.deepEqual(photo, { ok: true, issues: [] })
  assert.ok(score >= 8)
})

test('бирка OAM Ózd под наклоном 12°: строки выпрямляются', () => {
  const { label } = extract(fixture('oam-ozd-tilted'), DEFAULT_FIELDS)
  assert.deepEqual(label, { producer: 'OAM Ózdi Acélművek', size: '12 mm', heat: '25R00581', weight_kg: 2650 })
})

test('бирка снята боком: прочитанная как есть не годится, лучший поворот — правильный', () => {
  const sideways = extract(fixture('oam-ozd-sideways'))
  const upsideDown = extract(fixture('oam-ozd-upside-down'))
  const turned = extract(fixture('oam-ozd-turned'))
  assert.equal(sideways.score, 0)
  assert.equal(sideways.photo.ok, false)
  assert.ok(turned.score > upsideDown.score)
  assert.equal(bestExtraction([sideways, upsideDown, turned]), turned)
  const { producer, size, heat, weight_kg } = turned.label
  assert.deepEqual({ producer, size, heat, weight_kg }, { producer: 'OAM Ózdi Acélművek', size: '12 mm', heat: '25R00581', weight_kg: 2650 })
})

test('грязная бирка SOVEL: значения в строку, время с двоеточиями, смена без точки', () => {
  const { label } = extract(fixture('sovel'))
  assert.equal(label.size, '8 mm')
  assert.equal(label.heat, '5800')
  assert.equal(label.weight_kg, 1990)
  assert.equal(label.production_date, '2025-12-22')
  assert.equal(label.production_time, '01:38:42')
  assert.equal(label.shift, '3')
  assert.equal(label.serial_number, '4985800')
})

test('значения после двоеточия в той же строке, тонны в килограммах, дата и время', () => {
  const { label } = extract(page([
    ['SUEZ STEEL CO.', 0.3, 0.05],
    ['Product: Rebar', 0.1, 0.15],
    ['Grade: B500B', 0.1, 0.2],
    ['Size: 12 mm', 0.1, 0.25],
    ['Heat No: 251216', 0.1, 0.3],
    ['Bundle No: 4657 / 30', 0.1, 0.35],
    ['Weight: 2.0 Ton Approx', 0.1, 0.4],
    ['Date: 04/01/2026', 0.1, 0.45],
    ['Time: 11:27 PM', 0.1, 0.5],
  ]))
  assert.equal(label.producer, 'Suez Steel')
  assert.equal(label.product, 'Rebar')
  assert.equal(label.grade, 'B500B')
  assert.equal(label.size, '12 mm')
  assert.equal(label.heat, '251216')
  assert.equal(label.batch, '4657 / 30')
  assert.equal(label.weight_kg, 2000)
  assert.equal(label.production_date, '2026-01-04')
  assert.equal(label.production_time, '23:27')
})

test('таблица: подписи в шапке, значения под ними', () => {
  const { label } = extract(page([
    ['ArcelorMittal Kryvyi Rih', 0.1, 0.05],
    ['Heat / Плавка', 0.1, 0.3, 0.15],
    ['Size, mm', 0.4, 0.3, 0.1],
    ['Weight, kg', 0.7, 0.3, 0.12],
    ['253830', 0.12, 0.345, 0.08],
    ['8', 0.43, 0.345, 0.02],
    ['2140', 0.72, 0.345, 0.06],
  ]), DEFAULT_FIELDS)
  assert.deepEqual(label, { producer: 'ArcelorMittal', size: '8 mm', heat: '253830', weight_kg: 2140 })
})

test('две подписи в одной строке: значение не уходит к чужой подписи', () => {
  const { label } = extract(page([
    ['Heat No', 0.05, 0.2, 0.1],
    ['25R00581', 0.2, 0.2, 0.1],
    ['Weight', 0.5, 0.2, 0.1],
    ['1 990 kg', 0.65, 0.2, 0.1],
    ['Diameter', 0.05, 0.3, 0.1],
    ['Ø16', 0.2, 0.3, 0.05],
  ]), DEFAULT_FIELDS)
  assert.equal(label.heat, '25R00581')
  assert.equal(label.weight_kg, 1990)
  assert.equal(label.size, '16 mm')
  assert.equal(label.producer, null)
})

test('похожие знаки в номере поправляются по QR-коду', () => {
  const rows: Row[] = [['Heat:', 0.05, 0.2, 0.08], ['25ROO581', 0.3, 0.2, 0.1]]
  assert.equal(extract(page(rows), DEFAULT_FIELDS).label.heat, '25RO0581')
  assert.equal(extract(page(rows), DEFAULT_FIELDS, [{ text: '25R00581/2650', format: 'qr' }]).label.heat, '25R00581')
})

test('данные из кода с подписями тоже читаются', () => {
  const { label } = extract(page([['www.example.com', 0.1, 0.9]]), DEFAULT_FIELDS, [{ text: 'HEAT NO: 251216\nWEIGHT: 2140 KG', format: 'qr' }])
  assert.equal(label.heat, '251216')
  assert.equal(label.weight_kg, 2140)
})

test('своё поле ищется по названиям на всех языках', () => {
  const length: LabelFieldDefinition = { key: 'length', names: { en: 'Length', ro: 'Lungime' }, hint: '', kind: 'code', enabled: true, builtIn: false }
  const { label } = extract(page([['Lungime: 12 m', 0.1, 0.2]]), [...DEFAULT_FIELDS, length])
  assert.equal(label.length, '12 m')
})

test('оценка фото: без текста — нет бирки, без подписей — переснять', () => {
  assert.deepEqual(extract(page([])).photo, { ok: false, issues: ['noTag'] })
  assert.deepEqual(extract(page([['lorem ipsum dolor', 0.1, 0.1]])).photo, { ok: false, issues: [] })
})

test('поворот фото: лучшая страница — с подписями полей', () => {
  const sideways = extract(page([['lƎ', 0.1, 0.1], ['ʇɥƃıǝM', 0.1, 0.2]]))
  const upright = extract(fixture('oam-ozd'))
  assert.equal(bestExtraction([sideways, upright]), upright)
  assert.equal(bestExtraction([]), null)
})

test('вес: единицы из значения или подписи, тысячи, тонны', () => {
  const kg = { label: 'Weight (kg)' }
  assert.equal(readWeightKg('2650', kg), 2650)
  assert.equal(readWeightKg('2 650', kg), 2650)
  assert.equal(readWeightKg('2.650', kg), 2650)
  assert.equal(readWeightKg('1990 Kg', { label: '' }), 1990)
  assert.equal(readWeightKg('2.0 Ton Approx', { label: '' }), 2000)
  assert.equal(readWeightKg('2,65', { label: 'Net weight, t' }), 2650)
  assert.equal(readWeightKg('2.65', { label: '' }), 2650)
  assert.equal(readWeightKg('12', kg), null)
  assert.equal(readWeightKg('heavy', kg), null)
})

test('размер, плавка, дата, время', () => {
  const none = { label: '' }
  assert.equal(readSize('12', none), '12 mm')
  assert.equal(readSize('Ø 16mm', none), '16 mm')
  assert.equal(readSize('R20', none), 'R20')
  assert.equal(readSize('8-16mm', none), null)
  assert.equal(readSize('B500C', none), null)
  assert.equal(readHeat('No. 25R 00581', none), '25R00581')
  assert.equal(readHeat('25R0O581', none), '25R00581')
  assert.equal(readHeat('Charge', none), null)
  assert.equal(readDate('2025-02 -12', none), '2025-02-12')
  assert.equal(readDate('22/12/2025 11:27', none), '2025-12-22')
  assert.equal(readDate('04.01.26', none), '2026-01-04')
  assert.equal(readDate('31/02/2025', none), null)
  assert.equal(readTime('11:27 AM', none), '11:27')
  assert.equal(readTime('12:05:09 am', none), '00:05:09')
  assert.equal(readTime('12:30 Production', none), '12:30')
})

test('поставщик: без регистра и диакритики, с ошибкой OCR, короткие — отдельным словом', () => {
  const suppliers = DEFAULT_KNOWN_SUPPLIERS
  assert.deepEqual(matchSupplier('İÇDAŞ ÇELİK ENERJİ', suppliers), { name: 'Icdas', exact: true })
  assert.deepEqual(matchSupplier('ArcelorMitta1 Kryvyi Rih', suppliers), { name: 'ArcelorMittal', exact: false })
  assert.deepEqual(matchSupplier('MDA S.A.', suppliers), { name: 'MDA', exact: true })
  assert.equal(matchSupplier('Commda trading', suppliers), null)
})

test('по умолчанию заполняются только включённые поля', () => {
  const { label } = extract(fixture('oam-ozd'), DEFAULT_FIELDS)
  assert.deepEqual(Object.keys(label), enabledLabelFields(createDefaultLabelFields()).filter((field) => !field.manual).map((field) => field.key))
})
