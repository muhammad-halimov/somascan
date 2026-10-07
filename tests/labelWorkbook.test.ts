/**
 * Журнал проб `.xlsx`: шаблон, поиск шапки, дописывание строк в лист года, новый год,
 * служебный лист с номерами записей, сохранность чужих данных, значения в формате журнала.
 * Запуск: `npm test`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { diameterCell, heatCell, quantityCell, arrivalDateText } from '../src/features/uploads/xlsx/labTableCells'
import { findLabLayout, knownColumnOf } from '../src/features/uploads/xlsx/labTableLayout'
import { LabelWorkbook, type LabEntry } from '../src/features/uploads/xlsx/LabelWorkbook'
import { cellKey, excelDateTime, normalizeHeader, readCell, toTableCell } from '../src/features/uploads/xlsx/tableCell'
import type { UploadColumn } from '../src/features/uploads/xlsx/uploadColumns'

const template = new Uint8Array(readFileSync(new URL('../src/features/uploads/xlsx/template/Probe otel.xlsx', import.meta.url)))
const columns: UploadColumn[] = [
  { key: 'producer', kind: 'text', header: 'Производитель', aliases: ['Producer', 'Producător'] },
  { key: 'grade', kind: 'code', header: 'Марка стали', aliases: ['Steel grade', 'Marcă oțel'] },
  { key: 'size', kind: 'code', header: 'Размер', aliases: ['Size'] },
  { key: 'heat', kind: 'code', header: 'Плавка', aliases: ['Heat number', 'Șarjă'] },
  { key: 'weight_kg', kind: 'weight', header: 'Вес', aliases: ['Weight'] },
]
const entry = (n: number, label: LabEntry['label']): LabEntry => ({ localNumber: `SCN-261008-000${n}`, label, columns })
const at = (year: number, month: number, day: number) => new Date(year, month - 1, day, 10, 30).getTime()

/** Значения строки по буквам колонок C…K. */
async function rowValues(bytes: Uint8Array, sheet: string, row: number) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])
  const values = workbook.getWorksheet(sheet)!.getRow(row)
  return Object.fromEntries(['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map((letter) => [letter, values.getCell(letter).value ?? null]))
}

test('шаблон: шапка журнала узнаётся, данных нет', async () => {
  const workbook = await LabelWorkbook.fromTemplate(template, 2026)
  assert.deepEqual(workbook.sheetNames, ['2026'])
  const rows = [...workbook.snapshot().keys()].map((key) => Number(/!(\d+):/.exec(key)![1]))
  assert.ok(rows.length > 0 && rows.every((row) => row < 7), 'только шапка и заголовок')
})

test('бирки дописываются по порядку: номер, вес, дата, плавка, завод, диаметр по форме', async () => {
  const workbook = await LabelWorkbook.fromTemplate(template, 2026)
  const first = workbook.append(entry(1, { producer: 'ArcelorMittal', heat: '253830', size: '10 mm', weight_kg: 8126, product_form: 'bobina', quality_doc: null }), at(2026, 10, 8))
  assert.deepEqual([first.sheet, first.row, first.newSheet], ['2026', 7, false])
  const second = workbook.append(entry(2, { producer: 'OAM', heat: '25R00205', size: 'Ø 16', weight_kg: '2419', product_form: 'bara', quality_doc: 'Am acte' }), at(2026, 10, 8))
  assert.equal(second.row, 8)

  const bytes = await workbook.toBytes()
  assert.deepEqual(await rowValues(bytes, '2026', 7), { C: 1, D: '8126Kg', E: null, F: '08.10.2026', G: 253830, H: 'ArcelorMittal', I: 10, J: null, K: null })
  assert.deepEqual(await rowValues(bytes, '2026', 8), { C: 2, D: '2419Kg', E: null, F: '08.10.2026', G: '25R00205', H: 'OAM', I: null, J: 16, K: 'Am acte' })

  const reopened = await LabelWorkbook.open(bytes)
  assert.deepEqual(reopened.locate('SCN-261008-0002'), { sheet: '2026', row: 8 })
  assert.equal(reopened.locate('SCN-261008-0009'), null)
  assert.deepEqual(reopened.sheetNames, ['2026'], 'служебный лист скрыт')
  assert.deepEqual(reopened.readCells({ sheet: '2026', row: 7 }, [4, 7]), ['8126Kg', 253830])
})

test('новый год — новый лист первым, с той же шапкой; прежний год не тронут', async () => {
  const workbook = await LabelWorkbook.fromTemplate(template, 2026)
  workbook.append(entry(1, { producer: 'Sovel', heat: '5673', size: '10', weight_kg: 4754, product_form: 'bobina' }), at(2026, 12, 30))
  const before = workbook.snapshot()
  const planned = workbook.append(entry(2, { producer: 'Sovel', heat: '5674', size: '12', weight_kg: 4800, product_form: 'bara' }), at(2027, 1, 3))
  assert.deepEqual([planned.sheet, planned.row, planned.newSheet], ['2027', 7, true])
  const bytes = await workbook.toBytes()
  const reopened = await LabelWorkbook.open(bytes)
  assert.deepEqual(reopened.sheetNames, ['2027', '2026'])
  assert.deepEqual(await rowValues(bytes, '2027', 7), { C: 1, D: '4800Kg', E: null, F: '03.01.2027', G: 5674, H: 'Sovel', I: null, J: 12, K: null })
  assert.equal((await rowValues(bytes, '2027', 4)).C, 'Nr. Crt.')
  assert.equal((await rowValues(bytes, '2027', 6)).I, 'Bobina')
  const after = reopened.snapshot()
  for (const [key, value] of before) assert.equal(after.get(key), value, key)

  // Оформление первой строки нового листа — как у первой строки данных прежнего года.
  const check = new ExcelJS.Workbook()
  await check.xlsx.load(bytes as unknown as Parameters<typeof check.xlsx.load>[0])
  const style = (sheet: string, cell: string) => JSON.stringify(check.getWorksheet(sheet)!.getCell(cell).style.fill ?? null)
  assert.equal(style('2027', 'G7'), style('2026', 'G7'))
  assert.equal(check.getWorksheet('2027')!.getCell('C4').isMerged, true, 'объединения шапки скопированы')
})

test('строки дописываются после последней с данными; заранее проставленные номера не мешают', async () => {
  const base = await LabelWorkbook.fromTemplate(template, 2026)
  const raw = new ExcelJS.Workbook()
  await raw.xlsx.load(await base.toBytes() as unknown as Parameters<typeof raw.xlsx.load>[0])
  const sheet = raw.getWorksheet('2026')!
  for (let row = 7; row <= 40; row++) sheet.getCell(`C${row}`).value = row - 6 // номера на будущее, как в журнале
  sheet.getCell('D7').value = '100Kg'
  sheet.getCell('G7').value = 1
  sheet.getCell('D9').value = '300Kg'
  sheet.getCell('E9').value = '11.02.2026' // дату отправки на испытание вписала лаборатория
  const workbook = await LabelWorkbook.open(new Uint8Array(await raw.xlsx.writeBuffer() as ArrayBuffer))
  const planned = workbook.append(entry(1, { producer: 'Habas', heat: '1', size: '8', weight_kg: 1, product_form: 'bobina' }), at(2026, 10, 8))
  assert.equal(planned.row, 10)
  assert.equal(planned.cells.get(3), 4, 'Nr. Crt. — следующий после номера строки 9')
})

test('чужая книга без шапки журнала — unknownLayout', async () => {
  const raw = new ExcelJS.Workbook()
  raw.addWorksheet('2026').addRow(['Somascan', 'Heat'])
  const workbook = await LabelWorkbook.open(new Uint8Array(await raw.xlsx.writeBuffer() as ArrayBuffer))
  assert.throws(() => workbook.append(entry(1, { heat: '1' }), at(2026, 10, 8)), (error: Error & { code?: string }) => error.code === 'unknownLayout')
})

test('шапка узнаётся без учёта регистра и диакритики; своя колонка поля — по названию', () => {
  assert.equal(knownColumnOf('Șarja'), 'heat')
  assert.equal(knownColumnOf('PRODUCĂTOR'), 'producer')
  assert.equal(knownColumnOf('Data trimitere la incercat'), 'sentToTest')
  assert.equal(knownColumnOf('Acte de calitate'), 'qualityDoc')
  assert.equal(knownColumnOf('Data sosirii'), 'arrivalDate')
  assert.equal(knownColumnOf('BST 500'), null)
  const grid: Record<string, string> = { '2:2': 'Nr. Crt.', '2:3': 'Producator', '2:4': 'Sarja', '2:5': 'Marcă oțel', '3:6': 'Bara' }
  const layout = findLabLayout((row, column) => grid[`${row}:${column}`] ?? '', [{ key: 'grade', aliases: ['Marcă oțel'] }])!
  assert.equal(layout.dataStart, 4)
  assert.equal(layout.fields.get('grade'), 5)
  assert.equal(layout.known.get('bar'), 6)
})

test('значения в формате журнала', () => {
  assert.equal(quantityCell(8126), '8126Kg')
  assert.equal(quantityCell('2 419'), '2 419')
  assert.equal(quantityCell('2140 kg'), '2140Kg')
  assert.equal(heatCell('253830'), 253830)
  assert.equal(heatCell('0016'), '0016', 'ведущий ноль сохраняется')
  assert.equal(heatCell('2601-2-315-31'), '2601-2-315-31')
  assert.equal(diameterCell('10 mm'), 10)
  assert.equal(diameterCell('Ø12'), 12)
  assert.equal(diameterCell('R20'), 20)
  assert.equal(diameterCell('8/7'), '8/7')
  assert.equal(diameterCell('12 мм'), 12)
  assert.equal(quantityCell('2140 кг'), '2140Kg')
  assert.equal(arrivalDateText(new Date(2026, 0, 4).getTime()), '04.01.2026')
})

test('повреждённый файл — corruptWorkbook', async () => {
  await assert.rejects(LabelWorkbook.open(new TextEncoder().encode('not a workbook')), (error: Error & { code?: string }) => error.code === 'corruptWorkbook')
})

test('значения ячеек по виду колонки', () => {
  assert.equal(toTableCell('number', '12'), 12)
  assert.equal(toTableCell('weight', '2,5'), 2.5)
  assert.equal(toTableCell('code', 7), '7')
  assert.equal(toTableCell('date', '2026-02-31'), '2026-02-31', 'несуществующая дата остаётся текстом')
  assert.equal(cellKey(toTableCell('date', '2026-01-04')), '2026-01-04')
  assert.equal(cellKey(excelDateTime(new Date(2026, 0, 4, 9, 5, 7).getTime())), '2026-01-04 09:05:07')
  assert.equal(readCell({ richText: [{ text: 'ab' }, { text: 'c' }] }), 'abc')
  assert.equal(normalizeHeader('  Heat   No '), 'heat no')
})
