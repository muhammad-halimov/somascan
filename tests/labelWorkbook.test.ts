/**
 * Проверки таблицы `.xlsx`: создание, поиск колонок по заголовкам, дописывание строк,
 * сохранение чужих колонок и листов, сверка после перечитывания.
 * Запуск: `npm test`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LabelWorkbook, normalizeHeader } from '../src/features/uploads/xlsx/LabelWorkbook'
import { cellKey, excelDateTime, readCell, sameCell, toTableCell } from '../src/features/uploads/xlsx/tableCell'
import type { UploadColumn } from '../src/features/uploads/xlsx/uploadColumns'

const columns: UploadColumn[] = [
  { key: '_record_number', kind: 'record_number', header: '№ записи', aliases: ['Record no.', '№ записи'] },
  { key: '_recorded_at', kind: 'recorded_at', header: 'Дата и время', aliases: ['Date and time', 'Дата и время'] },
  { key: 'heat', kind: 'code', header: 'Плавка', aliases: ['heat', 'Heat', 'Плавка', 'Șarjă'] },
  { key: 'weight_kg', kind: 'weight', header: 'Вес, кг', aliases: ['weight_kg', 'Weight, kg', 'Вес, кг'] },
  { key: 'production_date', kind: 'date', header: 'Дата производства', aliases: ['production_date', 'Production date'] },
]

test('новая книга: заголовки, строка, перечитывание', async () => {
  const workbook = await LabelWorkbook.create()
  const map = workbook.ensureColumns(columns)
  assert.deepEqual([...map.values()], [1, 2, 3, 4, 5])
  const cells = new Map([
    [1, 'SCN-261007-0001'],
    [2, excelDateTime(Date.UTC(2026, 9, 7, 10, 30, 15))],
    [3, toTableCell('code', '0251216')],
    [4, toTableCell('weight', '2140')],
    [5, toTableCell('date', '2026-01-04')],
  ])
  const row = workbook.appendRow(cells)
  assert.equal(row, 2)

  const reopened = await LabelWorkbook.open(await workbook.toBytes())
  assert.equal(reopened.lastRow, 2)
  const map2 = reopened.ensureColumns(columns)
  assert.deepEqual([...map2.values()], [1, 2, 3, 4, 5])
  assert.equal(reopened.findRow(1, 'SCN-261007-0001'), 2)
  const actual = reopened.readRow(2, [1, 2, 3, 4, 5])
  cells.forEach((expected, column) => assert.ok(sameCell(expected, actual[column - 1]!), `колонка ${column}: ${cellKey(expected)} ≠ ${cellKey(actual[column - 1]!)}`))
  assert.equal(actual[2], '0251216', 'код с ведущим нулём остаётся текстом')
  assert.equal(actual[3], 2140, 'вес — число')
})

test('чужая таблица: колонки находятся по псевдонимам, недостающие добавляются, лишние не трогаются', async () => {
  const foreign = await LabelWorkbook.create()
  foreign.ensureColumns([
    { key: 'x_comment', kind: 'text', header: 'Comment', aliases: ['Comment'] },
    { key: 'heat', kind: 'code', header: 'Heat', aliases: ['Heat'] },
    { key: '_record_number', kind: 'record_number', header: 'record no.', aliases: ['record no.'] },
  ])
  foreign.appendRow(new Map([[1, 'manual row'], [2, 'H-1'], [3, 'SCN-OLD-0001']]))
  const workbook = await LabelWorkbook.open(await foreign.toBytes())
  const map = workbook.ensureColumns(columns)
  assert.equal(map.get('heat'), 2, 'Heat найдена по псевдониму без учёта регистра')
  assert.equal(map.get('_record_number'), 3)
  assert.equal(map.get('_recorded_at'), 4, 'новая колонка добавлена в конец')
  assert.equal(map.get('weight_kg'), 5)
  assert.equal(map.get('production_date'), 6)
  const row = workbook.appendRow(new Map([[3, 'SCN-NEW-0002'], [2, 'H-2']]))
  assert.equal(row, 3)
  const reopened = await LabelWorkbook.open(await workbook.toBytes())
  assert.deepEqual([...reopened.headers().values()], ['Comment', 'Heat', 'record no.', 'Дата и время', 'Вес, кг', 'Дата производства'])
  assert.equal(reopened.readRow(2, [1])[0], 'manual row', 'чужая строка сохранена')
  assert.equal(reopened.findRow(3, 'SCN-NEW-0002'), 3)
})

test('повреждённый файл — corruptWorkbook', async () => {
  await assert.rejects(LabelWorkbook.open(new TextEncoder().encode('not a workbook')), (error: Error & { code?: string }) => error.code === 'corruptWorkbook')
})

test('значения ячеек по виду колонки', () => {
  assert.equal(toTableCell('number', '12'), 12)
  assert.equal(toTableCell('weight', '2,5'), 2.5)
  assert.equal(toTableCell('weight', '2140 kg'), '2140 kg')
  assert.equal(toTableCell('code', 7), '7')
  assert.equal(toTableCell('code', null), null)
  assert.equal(toTableCell('date', '2026-02-31'), '2026-02-31', 'несуществующая дата остаётся текстом')
  assert.equal(cellKey(toTableCell('date', '2026-01-04')), '2026-01-04')
  assert.equal(cellKey(excelDateTime(new Date(2026, 0, 4, 9, 5, 7).getTime())), '2026-01-04 09:05:07')
  assert.equal(readCell({ richText: [{ text: 'ab' }, { text: 'c' }] }), 'abc')
  assert.equal(normalizeHeader('  Heat   No '), 'heat no')
})

test('служебная колонка даты узнаёт прежний заголовок «Дата и время»', async () => {
  const { buildUploadColumns, RECORDED_AT_KEY } = await import('../src/features/uploads/xlsx/uploadColumns')
  const old = await LabelWorkbook.create()
  old.ensureColumns([{ key: '_record_number', kind: 'record_number', header: '№ записи', aliases: [] }, { key: '_recorded_at', kind: 'recorded_at', header: 'Дата и время', aliases: [] }])
  const reopened = await LabelWorkbook.open(await old.toBytes())
  const map = reopened.ensureColumns(buildUploadColumns([], 'ru'))
  assert.equal(map.get(RECORDED_AT_KEY), 2, 'новая версия пишет в ту же колонку')
  assert.deepEqual([...reopened.headers().values()], ['№ записи', 'Дата и время', 'Форма'], 'колонка формы добавлена в конец')
})

test('форма поставки пишется в таблицу румынским словом', async () => {
  const { buildUploadColumns } = await import('../src/features/uploads/xlsx/uploadColumns')
  const { toTableCell } = await import('../src/features/uploads/xlsx/tableCell')
  const columns = buildUploadColumns([], 'ru')
  const form = columns.find((column) => column.key === 'product_form')!
  assert.equal(form.header, 'Форма')
  assert.ok(form.aliases.includes('Formă') && form.aliases.includes('Form'))
  assert.equal(toTableCell(form.kind, 'bobina'), 'bobina')
})

test('колонка даты достаточно широкая, чтобы Excel не показывал #####', async () => {
  const { buildUploadColumns, RECORDED_AT_KEY } = await import('../src/features/uploads/xlsx/uploadColumns')
  const narrow = await LabelWorkbook.create()
  narrow.ensureColumns([{ key: '_record_number', kind: 'record_number', header: '№ записи', aliases: [] }, { key: '_recorded_at', kind: 'recorded_at', header: 'Дата и время', aliases: [] }])
  const reopened = await LabelWorkbook.open(await narrow.toBytes())
  const map = reopened.ensureColumns(buildUploadColumns([], 'ru'))
  const again = await LabelWorkbook.open(await reopened.toBytes())
  const width = (again as unknown as { sheet: { getColumn: (n: number) => { width?: number } } }).sheet.getColumn(map.get(RECORDED_AT_KEY)!).width ?? 0
  assert.ok(width >= 20, `ширина ${width}`)
})
