/**
 * Мост с телефонами (`--bridge`): бирки из копии Probe в Google Drive переносятся в Probe той же строкой, что
 * записал бы телефон; перенесённые не повторяются, плавка — один раз, записи прежних версий пропускаются с причиной,
 * открытый в редакторе Probe не трогается, лист нового года создаётся.
 * Фикстура `fixtures/Probe otel.xlsx` — пустой журнал с листом «2026» из мобильного приложения.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { parseEngineOptions } from '../src/engine/EngineOptions'
import type { UploadColumn } from '../src/engine/lab/labelValues'
import { JOURNAL_SHEET, LabelWorkbook, type LabEntry } from '../src/engine/lab/LabelWorkbook'
import { MemorySink } from '../src/engine/RunReport'
import { SyncEngine } from '../src/engine/SyncEngine'
import { ENGINE_EXIT, type RunSummary } from '../src/shared/protocol'

const template = fs.readFileSync(new URL('./fixtures/Probe otel.xlsx', import.meta.url))
const columns: UploadColumn[] = [
  { key: 'producer', kind: 'text', header: 'Производитель', aliases: ['Producer'] },
  { key: 'size', kind: 'code', header: 'Размер', aliases: ['Size'] },
  { key: 'heat', kind: 'code', header: 'Плавка', aliases: ['Heat number'] },
  { key: 'weight_kg', kind: 'weight', header: 'Вес', aliases: ['Weight'] },
]
const tag = (n: number, heat: string): LabEntry => ({
  localNumber: `SCN-261008-000${n}`,
  label: { producer: 'Sovel', size: '12 mm', heat, weight_kg: 2000 + n, product_form: 'bara' },
  columns,
})
const at = (year: number, month: number, day: number) => new Date(year, month - 1, day, 10, 30).getTime()

/** Книга-журнал с бирками (как её оставил бы телефон). */
async function book(tags: ReadonlyArray<readonly [LabEntry, number]>): Promise<Uint8Array> {
  const workbook = await LabelWorkbook.open(template)
  for (const [entry, writtenAt] of tags) workbook.append(entry, writtenAt)
  return workbook.toBytes()
}

/** Папка с копией с Drive и Probe. */
function files(copy: Uint8Array, probe: Uint8Array) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somasync-bridge-'))
  const files = { dir, copy: path.join(dir, 'drive-copy.xlsx'), probe: path.join(dir, 'Probe otel.xlsx') }
  fs.writeFileSync(files.copy, copy)
  fs.writeFileSync(files.probe, probe)
  return files
}

/** Прогон моста. */
async function bridge(f: { dir: string; copy: string; probe: string }) {
  const jsonOut = path.join(f.dir, 'out.json')
  const options = parseEngineOptions(['--bridge', '--apply', f.copy, f.probe], { JSON_OUT: jsonOut, BACKUP_DAYS: '30' })
  const sink = new MemorySink()
  const code = await new SyncEngine(options, sink).run()
  return { code, sink, summary: JSON.parse(fs.readFileSync(jsonOut, 'utf8')) as RunSummary }
}

/** Значения строки Probe. */
async function rowValues(file: string, sheet: string, row: number): Promise<unknown[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(file)
  const values = workbook.getWorksheet(sheet)!.getRow(row).values
  return Array.isArray(values) ? values.filter((v) => v !== undefined && v !== null) : []
}

test('новые бирки с телефонов дописываются в Probe; перенесённые и та же плавка — нет', async () => {
  // Probe: бирка 1 уже перенесена, плавку H3 внесли вручную (другая запись); телефоны дописали в копию 2 и 3.
  const probe = await book([[tag(1, 'H1'), at(2026, 10, 1)], [{ ...tag(9, 'H3'), localNumber: 'SCN-MANUAL' }, at(2026, 10, 2)]])
  const copy = await book([[tag(1, 'H1'), at(2026, 10, 1)], [tag(2, 'H2'), at(2026, 10, 5)], [tag(3, 'H3'), at(2026, 10, 6)]])
  const f = files(copy, probe)
  const { code, summary } = await bridge(f)
  assert.equal(code, ENGINE_EXIT.ok)
  assert.equal(summary.command, 'bridge')
  assert.equal(summary.wrote, true)
  assert.deepEqual(summary.bridged.map((b) => [b.record, b.heat, b.sheet, b.item]), [['SCN-261008-0002', 'H2', '2026', 3]])
  assert.deepEqual(summary.skipped.map((s) => [s.element, s.reason.code]), [['H3', 'lab.duplicateHeat']])
  assert.ok(summary.backup)
  const row = summary.bridged[0]!.row
  // строка как у телефона: номер, вес с Kg, плавка, производитель, Ø прутка
  const values = await rowValues(f.probe, '2026', row)
  for (const value of [3, '2002Kg', 'H2', 'Sovel', 12]) assert.ok(values.includes(value), `${String(value)} в строке ${row}: ${JSON.stringify(values)}`)
  const after = await LabelWorkbook.open(fs.readFileSync(f.probe))
  assert.deepEqual(after.locate('SCN-261008-0002'), { sheet: '2026', row })
  assert.equal(after.findHeat('H2')?.row, row)

  // повторный прогон: переносить нечего, Probe не меняется
  const before = fs.readFileSync(f.probe)
  const again = await bridge(f)
  assert.equal(again.code, ENGINE_EXIT.ok)
  assert.equal(again.summary.wrote, false)
  assert.deepEqual(again.summary.bridged, [])
  assert.ok(fs.readFileSync(f.probe).equals(before))
})

test('запись прежней версии (без бирки) пропускается с причиной', async () => {
  const copy = new ExcelJS.Workbook()
  await copy.xlsx.load((await book([[tag(2, 'H2'), at(2026, 10, 5)]])) as unknown as Parameters<typeof copy.xlsx.load>[0])
  copy.getWorksheet(JOURNAL_SHEET)!.addRow(['SCN-OLD-0001', '2026', 9, new Date(at(2026, 10, 4)).toISOString()])
  const f = files(new Uint8Array(await copy.xlsx.writeBuffer() as ArrayBuffer), await book([]))
  const { code, summary } = await bridge(f)
  assert.equal(code, ENGINE_EXIT.ok)
  assert.deepEqual(summary.bridged.map((b) => b.record), ['SCN-261008-0002'])
  assert.deepEqual(summary.skipped.map((s) => [s.element, s.reason.code]), [['SCN-OLD-0001', 'bridge.noEntry']])
})

test('Probe открыт в Excel — перенос отложен (код 3), файл не тронут', async () => {
  const f = files(await book([[tag(2, 'H2'), at(2026, 10, 5)]]), await book([]))
  fs.writeFileSync(path.join(f.dir, '~$Probe otel.xlsx'), '')
  const before = fs.readFileSync(f.probe)
  const { code, summary } = await bridge(f)
  assert.equal(code, ENGINE_EXIT.deferred)
  assert.equal(summary.wrote, false)
  assert.deepEqual(summary.deferred.map((d) => d.file), ['Probe otel.xlsx'])
  assert.ok(fs.readFileSync(f.probe).equals(before))
})

test('бирка нового года: лист года, созданный телефоном в копии, создаётся и в Probe', async () => {
  const f = files(await book([[tag(4, 'H4'), at(2027, 1, 3)]]), await book([]))
  const { code, summary } = await bridge(f)
  assert.equal(code, ENGINE_EXIT.ok)
  assert.deepEqual(summary.bridged.map((b) => [b.heat, b.sheet, b.item]), [['H4', '2027', 1]])
  const after = await LabelWorkbook.open(fs.readFileSync(f.probe))
  assert.deepEqual(after.sheetNames, ['2027', '2026'])
})
