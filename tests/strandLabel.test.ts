/**
 * Бирки канатов (PC strand) на устройстве: плавки на них нет — её место занимает номер партии (BPM: «LOT NO»),
 * без него номер бухты (D&D Drótáru: «Coil Nr.»); номер бухты в партии («COIL NO. 6») — не плавка; диаметр без
 * подписи — из обозначения («Y1860 S7-12,9-F1-C1-R1»); BPM и D&D Drótáru — в списке поставщиков.
 * Запуск: `npm test`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DEFAULT_KNOWN_SUPPLIERS } from '../src/features/recognition/label/knownSuppliers'
import { createDefaultLabelFields } from '../src/features/recognition/label/labelFields'
import { buildLabelPrompt } from '../src/features/recognition/label/labelPrompt'
import { extractLabel } from '../src/features/recognition/ocr/LabelExtractor'
import type { OcrPage } from '../src/features/recognition/ocr/ocrTypes'
import { DEFAULT_RULE_LABELS } from '../src/features/recognition/ocr/ruleLabels'
import { findStrandLot as findLot, findStrandSize, matchMask } from '../src/features/recognition/ocr/strandTag'

/** Поля по умолчанию (производитель, размер, плавка, вес), читаемые с фото. */
const FIELDS = createDefaultLabelFields().filter((field) => field.enabled && !field.manual)

/** Страница из строк: текст, x и y в долях страницы 1000×1000. */
function page(rows: ReadonlyArray<[string, number, number]>): OcrPage {
  return {
    rotation: 0,
    width: 1000,
    height: 1000,
    lines: rows.map(([text, x, y]) => {
      const [left, top, right, bottom] = [x * 1000, y * 1000, (x + text.length * 0.012) * 1000, (y + 0.03) * 1000]
      return { text, corners: [left, top, right, top, right, bottom, left, bottom], confidence: 0.9 }
    }),
  }
}

const read = (rows: ReadonlyArray<[string, number, number]>, ruleLabels: Record<string, string[]> = {}) =>
  extractLabel({ page: page(rows), codes: [], fields: FIELDS, suppliers: DEFAULT_KNOWN_SUPPLIERS, ruleLabels }).label

/** Номер партии по шаблонам по умолчанию. */
const findStrandLot = (text: string) => findLot(text, DEFAULT_RULE_LABELS.strand_lot_masks!)

test('BPM (Кишинёв): плавка — номер партии (LOT NO), а не «COIL NO. 6»; диаметр по подписи', () => {
  const label = read([
    ['BPM', 0.3, 0.05],
    ['PC STRAND', 0.3, 0.09],
    ['PRESTRESSED CONCRETE STRAND - PC STRAND', 0.1, 0.15],
    ['PRODUCTION DATE', 0.15, 0.2], ['09/09/2026', 0.55, 0.2],
    ['SPECIFICATION', 0.15, 0.25], ['LOW RELAXATION', 0.55, 0.235], ['7-Wire Plain PC Strand', 0.55, 0.26], ['Y1860T7-R1-F1-C1', 0.55, 0.285],
    ['STANDARD', 0.15, 0.32], ['ST 009-2011', 0.55, 0.32],
    ['NOMINAL DIAMETER, mm', 0.15, 0.36], ['15.2', 0.6, 0.36],
    ['WEIGHT, KG', 0.15, 0.4], ['2845', 0.6, 0.4],
    ['LENGTH, M', 0.15, 0.44], ['2630', 0.6, 0.44],
    ['COIL NO.', 0.15, 0.48], ['6', 0.62, 0.48],
    ['INNER COIL DIAMETER, mm', 0.15, 0.52], ['800', 0.6, 0.52],
    ['LAY DIRECTION', 0.15, 0.56], ['Left', 0.6, 0.56],
    ['LOT NO.', 0.15, 0.6], ['260909G392-06-2', 0.55, 0.6],
    ['104 UZINELOR STR. CHISINAU, MD-2023 www.bpmpcstrand.md', 0.05, 0.65],
    ['MADE IN THE REPUBLIC OF MOLDOVA', 0.2, 0.68],
  ])
  assert.deepEqual([label.producer, label.size, label.heat, label.weight_kg], ['BPM', '15.2 mm', '260909G392-06-2', 2845])
})

test('D&D Drótáru (Мишкольц): плавка — номер бухты (Coil Nr.), диаметр — из обозначения «S7-12,9»', () => {
  const label = read([
    ['D&D', 0.3, 0.05],
    ['DRÓTÁRU ZRT.', 0.25, 0.12],
    ['H-3527 Miskolc, Sajószigeti út 4.', 0.2, 0.17],
    ['E-mail:contact@drotaru.hu - www.drotaru.hu', 0.15, 0.22],
    ['D&D Drótáru Ipari és Ker. ZRt', 0.35, 0.28],
    ['HUNGARY', 0.45, 0.31],
    ['pc-strand prEN 10138-3 Y1860 S7-12,9-F1-C1-R1, LEFT', 0.08, 0.36],
    ['Agrement Technic: 001SC-01/340-2025', 0.08, 0.39],
    ['Coil Nr.', 0.12, 0.45], ['Weight:', 0.5, 0.47], ['2930', 0.7, 0.47], ['kg', 0.8, 0.47],
    ['26D0222', 0.1, 0.495],
    ['Length:', 0.5, 0.56], ['3745', 0.7, 0.56], ['m', 0.8, 0.56],
  ])
  assert.deepEqual([label.producer, label.size, label.heat, label.weight_kg], ['D&D Drótáru', '12,9 mm', '26D0222', 2930])
})

test('обозначение каната: диаметр после S7/S3; без него и вне пределов — нет', () => {
  assert.equal(findStrandSize('Y1860S7-15,2'), '15,2 mm')
  assert.equal(findStrandSize('prEN 10138-3 Y1860 S3-6,5-F1'), '6,5 mm')
  assert.equal(findStrandSize('Y1860T7-R1-F1-C1'), null)
  assert.equal(findStrandSize('prEN 10138-3'), null)
})

test('арматура с номером пачки и без подписи плавки — пачка плавкой не становится (это не канат)', () => {
  const label = read([
    ['ArcelorMittal', 0.3, 0.05],
    ['Bundle No', 0.15, 0.2], ['250123456', 0.55, 0.2],
    ['Weight', 0.15, 0.25], ['2050 kg', 0.55, 0.25],
  ])
  assert.notEqual(label.heat, '250123456')
})

test('модели: правило 10 промпта по умолчанию и пояснение плавки — канаты (LOT NO, иначе Coil Nr.)', () => {
  const prompt = buildLabelPrompt('', FIELDS)
  assert.match(prompt, /10\. Tags of prestressed concrete strand/)
  assert.match(prompt, /"heat" — .*Prestressed strand tags .*LOT NO.*Coil Nr\./)
})

test('BPM: бледную подпись «LOT NO» OCR не узнал — номер партии узнаётся по виду (дата ГГММДД и дефисы)', () => {
  const label = read([
    ['BPM', 0.3, 0.05],
    ['PRESTRESSED CONCRETE STRAND - PC STRAND', 0.1, 0.15],
    ['NOMINAL DIAMETER, mm', 0.15, 0.36], ['15.2', 0.6, 0.36],
    ['WEIGHT, KG', 0.15, 0.4], ['2845', 0.6, 0.4],
    ['COIL NO.', 0.15, 0.48], ['6', 0.62, 0.48],
    ['1OT N0', 0.15, 0.6], ['260909G392 - 06 - 2', 0.55, 0.6],
  ])
  assert.equal(label.heat, '260909G392-06-2')
  assert.equal(findStrandLot('1OT N0. 260909G392-06-2'), '260909G392-06-2')
  // мелкий бледный шрифт: буквы вместо цифр в дате, пробел посреди номера, тире и подчёркивание вместо дефиса
  assert.equal(findStrandLot('26O9O9G392-06-2'), '260909G392-06-2')
  assert.equal(findStrandLot('260909G 392-06-2'), '260909G392-06-2')
  assert.equal(findStrandLot('260909G392 – 06_2'), '260909G392-06-2')
  assert.equal(findStrandLot('260909G392.06-2'), '260909G392-06-2')
  assert.equal(findStrandLot('09/09/2026'), null)
  assert.equal(findStrandLot('ST 009-2011'), null)
  assert.equal(findStrandLot('Y1860T7-R1-F1-C1'), null)
})

test('BPM, настоящее чтение ML Kit (fixtures/ocr/bpm-strand.json): производитель, размер и вес — да; номер партии, испорченный OCR, — не угадывается', () => {
  // ML Kit не прочёл подпись «LOT NO.» и номер бухты «6», а номер партии «260909G392-06-2» прочёл как
  // «2609090392.0ó-2» (G — нулём, 6 — «ó»): угадать номер нельзя — плавка остаётся пустой, её вводят вручную.
  const page = JSON.parse(readFileSync(new URL('./fixtures/ocr/bpm-strand.json', import.meta.url), 'utf8')) as OcrPage
  const label = extractLabel({ page, codes: [], fields: FIELDS, suppliers: DEFAULT_KNOWN_SUPPLIERS }).label
  assert.deepEqual([label.producer, label.size, label.weight_kg, label.heat], ['BPM', '15,2 mm', 2845, null])
})

test('шаблон номера: 9 — цифра (буква-двойник становится цифрой), A — буква, X — буква или цифра, дефис и длина — как в шаблоне', () => {
  assert.equal(matchMask('26O9O9G392-06-2', '999999A999-99-9'), '260909G392-06-2')
  assert.equal(matchMask('2609090392-06-2', '999999A999-99-9'), null, 'буква шаблона, прочитанная цифрой, не угадывается')
  assert.equal(matchMask('AB-12', 'XX-99'), 'AB-12')
  assert.equal(matchMask('26D0222', '99A999'), null)
})

test('особые правила из «Правил»: свои слова канатов и шаблоны партии, свой склад — правка без обновления приложения', () => {
  const rows: Array<[string, number, number]> = [
    ['ACME', 0.3, 0.05],
    ['LITZE 1860 HOCHFEST', 0.1, 0.15],
    ['WEIGHT, KG', 0.15, 0.4], ['2100', 0.6, 0.4],
    ['AB-1234-77', 0.55, 0.6],
  ]
  assert.equal(read(rows).heat, null, 'стандартные шаблоны такой номер не берут')
  assert.equal(read(rows, { strand_lot_masks: ['AA-9999-99'] }).heat, 'AB-1234-77')
  assert.equal(read(rows, { strand_lot_masks: ['AA-9999-99'], strand_words: ['strand'] }).heat, null, 'без слова «Litze» это не канат')
  const house = [['SANTIER 12', 0.1, 0.1], ['Kg: 1200', 0.1, 0.2]] as Array<[string, number, number]>
  assert.equal(read([...house, ['SOMACO', 0.1, 0.3]]).producer, 'SOMACO')
  assert.equal(read([...house, ['DEPOZIT NORD', 0.1, 0.3]], { house_supplier: ['Depozit Nord'] }).producer, 'Depozit Nord')
})
