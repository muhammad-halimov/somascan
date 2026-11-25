/**
 * Таблица лаборатории. Миграция (`--laborator --migrate`): бюллетень и дата из общей ячейки — в свои колонки,
 * оригинал остаётся рядом как «Laborator Orig.xlsx». Чтение при слежении (`--laborator --read`): копия и последняя
 * запись «Rc decofr.», «Nr.bul.», «Data» с подписью лаборанта, таблица не меняется. Проверка в «Хранилище» находит
 * шапку так же, как движок. Таблица — как настоящая: заголовок с объединениями, шапка в строке 5, «Rc decofr.»
 * и «Rc 28 zile» с колонкой бюллетеня, фильтр и область печати, строка-брак с объединением, ячейки с опечатками.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { findHeader } from '../src/engine/laborator/LabHeader'
import { dateLabel, LaboratorBook, parseResult } from '../src/engine/laborator/LaboratorBook'
import { StorageService } from '../src/host/StorageService'
import { workbookHead } from '../src/host/workbookHead'
import { ENGINE_EXIT, runOutcome } from '../src/shared/protocol'
import { runEngine } from './fixtures'

/** Таблица лаборатории прежнего вида. */
async function writeLaborator(file: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.getCell('A1').value = 'SOMACO GRUP PREFABRICATE SRL'
  ws.mergeCells('A1:C1')
  ws.getCell('K2').value = 'Cod formular FL 01-02'
  ws.mergeCells('K2:M2')
  ws.getCell('A4').value = 'Evidenta rezultatelor incercarilor efectuate pe cuburile de proba din beton -2026'
  ws.mergeCells('A4:K4')
  const head = ['Data turn. elem.', 'Obiectul \nNr.Proiect', 'Denum \nelem. pref.', 'Simbol', 'Nr.\nproba', 'Seria', 'Clasa beton', 'Rc decofr.\nNr.bul./\nData', 'Rci transf.\nNr.bul./\nData', 'Rc transf.\nNr.bul./\nData', 'Rc livrare\nNr.bul./\nData', 'Rc 28 zile\n\n', '\nNr.bul./Data\n', 'OBSERVATII\nTIP ADITIV']
  head.forEach((h, i) => {
    const cell = ws.getCell(5, i + 1)
    cell.value = h
    cell.border = { left: { style: 'thin' }, right: { style: 'thin' } }
  })
  const rows: Array<Record<string, ExcelJS.CellValue>> = [
    { A: new Date(Date.UTC(2026, 0, 8)), G: 'C40/50', H: '32.8\n1B/09.01.2026', K: '47.8\n1B/15.01.2026', L: 63.2, M: '1B/05.02.2026', N: 'ME5060' },
    { G: 'C35/45', H: '28\n13.01.2026', L: 56.2, M: '5B/09.02.2026', N: 'ME5060' },
    { G: 'C30/37', H: '37..5\n903B/09.09.2026', M: '891B/020.10.2026', N: 'ME 5060' },
    { G: 'C50/60', F: 'SERIA 32 REBUT', N: 'ME 5060' },
    { G: 'C40/50', H: '31.9\n15B/', M: 60.3 },
  ]
  rows.forEach((values, i) => {
    for (const [column, value] of Object.entries(values)) ws.getCell(`${column}${6 + i}`).value = value
  })
  ws.mergeCells('H9:M9')
  ws.getColumn(8).width = 15.5
  ws.getColumn(13).width = 14.5
  ws.getColumn(14).width = 5.5
  ws.autoFilter = 'A5:N10'
  ws.pageSetup.printArea = 'A1:M10'
  wb.definedNames.add('Sheet1!$A$5:$N$10', '_xlnm._FilterDatabase')
  await wb.xlsx.writeFile(file)
}

/** Папка с таблицей лаборатории. */
async function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somasync-lab-'))
  const file = path.join(dir, 'Laborator.xlsx')
  await writeLaborator(file)
  return { dir, file, orig: path.join(dir, 'Laborator Orig.xlsx') }
}

/** Прогон движка. */
const engine = runEngine

const migrate = (f: { dir: string; file: string }, apply = true) => engine(f.dir, ['--laborator', '--migrate', ...(apply ? ['--apply'] : []), f.file])

const read = (f: { dir: string; file: string }, signature = '') => engine(f.dir, ['--laborator', '--read', f.file], signature ? { SIGNATURE: signature } : {})

/** Копии таблицы лаборатории. */
const backups = (dir: string) => (fs.existsSync(path.join(dir, 'backup', 'Laborator')) ? fs.readdirSync(path.join(dir, 'backup', 'Laborator')) : [])

/** Значение ячейки: дата — текстом «09.01.2026». */
const valueAt = (ws: ExcelJS.Worksheet, address: string) => {
  const v = ws.getCell(address).value
  return v instanceof Date ? dateLabel(v) : v
}

async function readSheet(file: string) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  return { wb, ws: wb.getWorksheet('Sheet1')! }
}

test('разбор ячейки: прочность, бюллетень, дата; опечатки — не разбираются', () => {
  const show = (raw: string, withValue: boolean) => {
    const p = parseResult(raw, withValue)
    return p && [p.value, p.bulletin, p.date && dateLabel(p.date)]
  }
  assert.deepEqual(show('32.8\n1B/09.01.2026', true), [32.8, '1B', '09.01.2026'])
  assert.deepEqual(show('60,5\n754B/04.08.2026', true), [60.5, '754B', '04.08.2026'])
  assert.deepEqual(show('28\n13.01.2026', true), [28, null, '13.01.2026'])
  assert.deepEqual(show('31.9\n15B/', true), [31.9, '15B', null])
  assert.deepEqual(show('1B/05.02.2026', false), [null, '1B', '05.02.2026'])
  assert.deepEqual(show('2B/05.02.26', false), [null, '2B', '05.02.2026'])
  for (const typo of ['37..5\n903B/09.09.2026', '31\n800B/18.08.02026', '34.8\n1145B/3 0.10.2026', 'C40/50']) assert.equal(parseResult(typo, true), null, typo)
  for (const typo of ['891B/020.10.2026', '888B/02.10.22026', '939B/13.10.2026+', '60.3', '1B/31.02.2026']) assert.equal(parseResult(typo, false), null, typo)
})

test('демонстрационная миграция: план и ячейки с опечатками, файл не меняется', async () => {
  const f = await workspace()
  const before = fs.readFileSync(f.file)
  const r = await migrate(f, false)
  assert.equal(r.code, ENGINE_EXIT.ok)
  assert.deepEqual(r.summary.split, [{ column: 'Rc decofr.', cells: 3 }, { column: 'Rc 28 zile', cells: 2 }])
  assert.deepEqual(r.summary.skipped.map((s) => s.element), ['H8', 'O8', 'O10'], 'адреса — как после разделения')
  assert.match(r.text, /не разобрано «37\.\.5 903B\/09\.09\.2026»/)
  assert.match(r.text, /пробный прогон/)
  assert.equal(r.summary.wrote, false)
  assert.deepEqual(fs.readFileSync(f.file), before)
  assert.ok(!fs.existsSync(f.orig))
  assert.ok(!fs.existsSync(path.join(f.dir, 'backup')))
})

test('миграция: бюллетень и дата — в свои колонки, остальное сдвинуто, оригинал — «Laborator Orig.xlsx»', async () => {
  const f = await workspace()
  const original = fs.readFileSync(f.file)
  const r = await migrate(f)
  assert.equal(r.code, ENGINE_EXIT.ok, r.text)
  assert.equal(r.summary.wrote, true)
  assert.equal(r.summary.verified, true)
  assert.equal(r.summary.original, 'Laborator Orig.xlsx')
  assert.deepEqual(fs.readFileSync(f.orig), original, 'оригинал — байт в байт')
  assert.equal(fs.readdirSync(path.join(f.dir, 'backup', 'Laborator')).length, 1, 'копия в backup/Laborator')

  const { wb, ws } = await readSheet(f.file)
  const row = (r: number, from: string, to: string) => {
    const out: unknown[] = []
    for (let c = ws.getColumn(from).number; c <= ws.getColumn(to).number; c++) out.push(valueAt(ws, `${ws.getColumn(c).letter}${r}`) ?? null)
    return out
  }
  assert.deepEqual(row(5, 'H', 'Q'), ['Rc decofr.', 'Nr.bul.', 'Data', 'Rci transf.\nNr.bul./\nData', 'Rc transf.\nNr.bul./\nData', 'Rc livrare\nNr.bul./\nData', 'Rc 28 zile\n\n', 'Nr.bul.', 'Data', 'OBSERVATII\nTIP ADITIV'])
  assert.deepEqual(row(6, 'H', 'Q'), [32.8, '1B', '09.01.2026', null, null, '47.8\n1B/15.01.2026', 63.2, '1B', '05.02.2026', 'ME5060'], 'Rc livrare не тронута')
  assert.deepEqual(row(7, 'H', 'J'), [28, null, '13.01.2026'])
  assert.deepEqual(row(8, 'H', 'J'), ['37..5\n903B/09.09.2026', null, null], 'опечатка — как была')
  assert.deepEqual(row(8, 'O', 'P'), ['891B/020.10.2026', null])
  assert.deepEqual(row(10, 'H', 'J'), [31.9, '15B', null])
  assert.deepEqual(row(10, 'O', 'P'), [60.3, null])
  assert.equal(ws.getCell('H6').numFmt, '0.0')
  assert.equal(ws.getCell('J6').numFmt, 'dd.mm.yyyy')
  assert.ok(ws.getCell('J6').value instanceof Date, 'дата — датой Excel')
  assert.equal(ws.getCell('I5').border?.left?.style, 'thin', 'новая колонка — со стилем соседней')

  const merges = (ws.model as { merges?: string[] }).merges ?? []
  assert.deepEqual([...merges].sort(), ['A1:C1', 'A4:M4', 'H9:O9', 'M2:O2'])
  assert.equal(ws.autoFilter, 'A5:Q10')
  assert.equal(ws.pageSetup.printArea, 'A1:P10')
  assert.deepEqual((wb.definedNames as unknown as { getRanges(n: string): { ranges: string[] } }).getRanges('_xlnm._FilterDatabase').ranges, ['Sheet1!$A$5:$Q$10'])
  assert.deepEqual([8, 9, 10, 13, 15, 17].map((c) => ws.getColumn(c).width), [15.5, 14, 14, undefined, 14.5, 5.5])
})

test('повторная миграция: таблица уже разделена — ничего не меняется', async () => {
  const f = await workspace()
  await migrate(f)
  const migrated = fs.readFileSync(f.file)
  const orig = fs.readFileSync(f.orig)
  const r = await migrate(f)
  assert.equal(r.code, ENGINE_EXIT.ok)
  assert.match(r.text, /уже разделена/)
  assert.deepEqual(r.summary.split, [])
  assert.equal(r.summary.wrote, false)
  assert.deepEqual(fs.readFileSync(f.file), migrated)
  assert.deepEqual(fs.readFileSync(f.orig), orig)
})

test('«Laborator Orig.xlsx» уже есть или таблица открыта — миграция не выполняется', async () => {
  const f = await workspace()
  const before = fs.readFileSync(f.file)
  fs.writeFileSync(f.orig, 'прежний оригинал')
  const exists = await migrate(f)
  assert.equal(exists.code, ENGINE_EXIT.error)
  assert.match(exists.text, /«Laborator Orig\.xlsx» уже есть/)
  assert.equal(fs.readFileSync(f.orig, 'utf8'), 'прежний оригинал')
  fs.rmSync(f.orig)
  fs.writeFileSync(path.join(f.dir, '~$Laborator.xlsx'), '')
  const open = await migrate(f)
  assert.equal(open.code, ENGINE_EXIT.error)
  assert.match(open.text, /открыт в редакторе/)
  assert.deepEqual(fs.readFileSync(f.file), before)
  assert.ok(!fs.existsSync(f.orig))
})

test('таблица без шапки «Rc decofr.» — ошибка с причиной', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somasync-lab-'))
  const file = path.join(dir, 'Laborator.xlsx')
  const wb = new ExcelJS.Workbook()
  wb.addWorksheet('Sheet1').getCell('A1').value = 'другая таблица'
  await wb.xlsx.writeFile(file)
  const r = await migrate({ dir, file })
  assert.equal(r.code, ENGINE_EXIT.error)
  assert.match(r.text, /не найдена шапка с «Rc decofr\.»/)
})

test('откат таблицы лаборатории к копии', async () => {
  const f = await workspace()
  const original = fs.readFileSync(f.file)
  const r = await migrate(f)
  const back = await engine(f.dir, ['--restore', r.summary.backup!, '--laborator', f.file])
  assert.equal(back.code, ENGINE_EXIT.ok, back.text)
  assert.deepEqual(fs.readFileSync(f.file), original)
  assert.equal(fs.readdirSync(path.join(f.dir, 'backup', 'Laborator')).length, 2, 'состояние перед откатом сохранено')
})

test('шапка: проверка в «Хранилище» (первые строки XML) находит то же, что движок (ExcelJS)', async () => {
  const f = await workspace()
  const engineHeader = async () => {
    const { header, decofr, splits } = (await LaboratorBook.open(fs.readFileSync(f.file))).layout()
    return { header, decofr, splits }
  }
  const storageHeader = async () => {
    const { header, decofr, splits } = findHeader(await workbookHead(fs.readFileSync(f.file), 20))
    return { header, decofr, splits }
  }
  // прежний вид: делятся «Rc decofr.» и колонка бюллетеня «Rc 28 zile»
  assert.deepEqual(await storageHeader(), await engineHeader())
  assert.equal((await storageHeader()).splits.length, 2)
  assert.deepEqual(await StorageService.labHeader(fs.readFileSync(f.file)), { error: { code: 'check.labNotSplit' } })
  await migrate(f)
  assert.deepEqual(await storageHeader(), await engineHeader())
  assert.deepEqual(await storageHeader(), { header: 5, decofr: 8, splits: [] })
  assert.deepEqual(await StorageService.labHeader(fs.readFileSync(f.file)), { row: 5, columns: 'H–J' })
})

test('чтение: копия и последняя запись Rc decofr. / Nr.bul. / Data, таблица не меняется', async () => {
  const f = await workspace()
  await migrate(f)
  // ниже — заготовленные строки без результатов (дата и добавка), как в настоящей таблице
  const { wb, ws } = await readSheet(f.file)
  ws.getCell('A12').value = new Date(Date.UTC(2026, 0, 20))
  ws.getCell('Q12').value = 'ME 5060'
  await wb.xlsx.writeFile(f.file)
  const before = fs.readFileSync(f.file)
  const copies = backups(f.dir).length

  const r = await read(f)
  assert.equal(r.code, ENGINE_EXIT.ok, r.text)
  assert.deepEqual(r.summary.lab, { row: 10, cell: 'H10', value: '31.9', bulletin: '15B', date: null, signature: null })
  assert.equal(runOutcome(r.summary, r.code), 'read')
  assert.equal(r.summary.wrote, false)
  assert.match(r.text, /Последняя запись — строка 10 \(H10\): Rc decofr\. 31\.9 · Nr\.bul\. 15B · Data —/)
  assert.match(r.text, /Подпись лаборанта не выбрана/)
  assert.deepEqual(fs.readFileSync(f.file), before, 'таблица не меняется')
  assert.equal(backups(f.dir).length, copies + 1, 'копия — в любом случае')

  // лаборант дописал строку — она и есть последняя; дата — как в таблице
  const next = await readSheet(f.file)
  next.ws.getCell('H11').value = 33.3
  next.ws.getCell('I11').value = '1158B'
  next.ws.getCell('J11').value = new Date(Date.UTC(2026, 10, 3))
  await next.wb.xlsx.writeFile(f.file)
  const signature = path.join(f.dir, 'laborator-1.png')
  fs.writeFileSync(signature, 'png')
  const again = await read(f, signature)
  assert.deepEqual(again.summary.lab, { row: 11, cell: 'H11', value: '33.3', bulletin: '1158B', date: '03.11.2026', signature: 'laborator-1.png' })
})

test('чтение: подпись лаборанта пропала — предупреждение; таблица в прежнем виде — ошибка, но копия есть', async () => {
  const f = await workspace()
  await migrate(f)
  const gone = await read(f, path.join(f.dir, 'нет.png'))
  assert.equal(gone.code, ENGINE_EXIT.ok)
  assert.equal(gone.summary.lab?.signature, null)
  assert.deepEqual(gone.summary.warnings, [{ code: 'laborator.signatureMissing' }])

  const old = await workspace()
  const r = await read(old)
  assert.equal(r.code, ENGINE_EXIT.error)
  assert.deepEqual(r.summary.error, { code: 'laborator.notSplit', params: { file: 'Laborator.xlsx' } })
  assert.equal(runOutcome(r.summary, r.code), 'failed')
  assert.equal(backups(old.dir).length, 1, 'копия сделана до разбора')
})

test('чтение: в таблице нет ни одной записи — «изменений нет»', async () => {
  const f = await workspace()
  await migrate(f)
  const { wb, ws } = await readSheet(f.file)
  for (let r = 6; r <= 10; r++) for (const c of ['H', 'I', 'J']) ws.getCell(`${c}${r}`).value = null
  ws.unMergeCells('H9:O9')
  await wb.xlsx.writeFile(f.file)
  const r = await read(f)
  assert.equal(r.code, ENGINE_EXIT.ok, r.text)
  assert.equal(r.summary.lab, null)
  assert.equal(runOutcome(r.summary, r.code), 'nothing')
})
