/**
 * Рапорт Betsy (`--laborator --betsy`): элемент рапорта находится в таблице лаборатории (тот же элемент,
 * заполненные Rc decofr. / Nr.bul. / Data, «Data» — за 0–3 рабочих дня до «TURNAT LA», выходные не в счёт;
 * «Data turn. elem.» не в счёт;
 * лучшая — с серией рапорта), прочность, дата и подпись лаборанта ложатся в строку 6 рапорта; копии обоих файлов, таблица
 * не меняется; повторная запись заменяет записанное. Рапорт и таблица — как настоящие: рамки Betsy (`w:framePr`)
 * и разделённая таблица лаборатории.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import zlib from 'node:zlib'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { BetsyReport, isReportName, latestReport, parseReportDate, pngSize } from '../src/engine/betsy/BetsyReport'
import { parseEngineOptions } from '../src/engine/EngineOptions'
import { dateLabel } from '../src/engine/laborator/LaboratorBook'
import { sameElement, sameProject, seriesContains, valueLabel } from '../src/engine/laborator/LabMatch'
import { resolveBetsyReport } from '../src/host/files'
import { StorageService } from '../src/host/StorageService'
import { runOutcome } from '../src/shared/protocol'
import { betsySource, DEFAULT_SETTINGS, parseSettings, type AppSettings } from '../src/shared/settings'
import { isWeekend, workdaysBefore, workdaysBetween } from '../src/shared/workdays'
import { runEngine } from './fixtures'

// ── Рапорт ───────────────────────────────────────────────────────────────────

/** Абзац в рамке (как у Betsy): место и размер в twips, текст — строки через `<w:br/>`. */
function frame(x: number, y: number, w: number, h: number, text = ''): string {
  const runs = text
    ? text.split('\n').map((line, i) => `<w:r><w:rPr><w:rStyle w:val="CharacterStyle13"/></w:rPr>${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${line}</w:t></w:r>`).join('')
    : ''
  return `<w:p><w:pPr><w:pStyle w:val="ParagraphStyle1"/><w:framePr w:w="${w}" w:h="${h}" w:hRule="exact" w:wrap="auto" w:vAnchor="page" w:hAnchor="margin" w:x="${x}" w:y="${y}"/><w:rPr><w:rStyle w:val="CharacterStyle14"/></w:rPr></w:pPr>${runs}</w:p>`
}

/** Ячейка таблицы рапорта: рамка с линиями и рамка с текстом поверх (на 28 twips правее). */
const cell = (x: number, y: number, w: number, h: number, text = '') => frame(x, y, w, h) + frame(x + 28, y, w - 26, h - 15, text)

/** Рапорт Betsy: шапка элемента, заголовки таблицы и строка 6. */
async function betsyDocx(fields: { code?: string; serie?: string; project?: string; cast?: string; row6?: boolean } = {}): Promise<Buffer> {
  const { code = 'PO08-TIP1', serie = '628', project = '92/8752', cast = '03/11/2026', row6 = true } = fields
  const body = [
    frame(293, 1851, 1351, 327, 'PROIECT NR:'),
    frame(1898, 1851, 5801, 327, project),
    frame(293, 2181, 1430, 342, 'TIP ELEMENT:'),
    frame(1898, 2181, 5726, 342, `PREDALA POD ${code}`),
    frame(293, 2523, 1549, 312, 'COD ELEMENT:'),
    frame(1898, 2523, 5603, 312, code),
    frame(293, 2835, 662, 312, 'Serie:'),
    frame(1011, 2835, 968, 312, serie),
    frame(2006, 2835, 540, 309, 'DoP:'),
    frame(2574, 2835, 1384, 312, '636667'),
    frame(7556, 2816, 1277, 327, 'TURNAT LA:'),
    frame(8889, 2816, 1693, 327, cast),
    cell(349, 3143, 3406, 750, 'Operatia'),
    cell(3799, 3143, 957, 750, 'Data'),
    cell(10134, 3143, 1182, 750, 'Semnatura'),
    cell(3799, 3893, 957, 1251, '23/11/2026'),
    ...(row6
      ? [
          cell(349, 10097, 3406, 923, '  a)Rezistenta betonului la decofrare ………........N/mm2\n  b)Rezistenta betonului la 28 de zile conform R.I. 28 de zile.'),
          cell(3799, 10097, 957, 923, '24/11/2026'),
          cell(4802, 10097, 2550, 923, 'Sef Laborator:'),
          cell(10134, 10097, 1182, 923),
        ]
      : []),
  ].join('')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** PNG `width`×`height` с прозрачным фоном и непрозрачной полосой посередине. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const out = Buffer.alloc(12 + data.length)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(zlib.crc32(body), 8 + data.length)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const rows = Buffer.concat(Array.from({ length: height }, (_, y) => Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, y === height >> 1 ? 0xff : 0)])))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

// ── Таблица лаборатории ──────────────────────────────────────────────────────

const day = (d: number, m = 11) => new Date(Date.UTC(2026, m - 1, d))

/** Разделённая таблица лаборатории (шапка в строке 5, как настоящая). */
async function writeLaborator(file: string): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.getCell('A1').value = 'SOMACO GRUP PREFABRICATE SRL'
  const head = ['Data turn. elem.', 'Obiectul \nNr.Proiect', 'Denum \nelem. pref.', 'Simbol\nElement\nPrefabricat', 'Nr.\nproba', 'Seria elem\nPrefabricat', 'Clasa beton', 'Rc decofr.', 'Nr.bul.', 'Data', 'Rci transf.\nNr.bul./\nData', 'Rc transf.\nNr.bul./\nData', 'Rc livrare\nNr.bul./\nData', 'Rc 28 zile\n\n', 'Nr.bul.', 'Data', 'OBSERVATII\nTIP ADITIV']
  head.forEach((h, i) => (ws.getCell(5, i + 1).value = h))
  const po08 = 'PREDALE POD \nPO 08'
  // «Data turn. elem.» (A) не в счёт: у подходящих строк она нарочно далеко, у неподходящей — в окне
  const rows: Array<Record<string, ExcelJS.CellValue>> = [
    // 6: «Data» (ср 28.10) за 4 рабочих дня до «TURNAT LA» (вт 03.11) — не подходит; до пн 02.11 — 3, подходит
    { A: day(2), C: po08, D: 'TIP 1', F: '92/8752-P-1-1323÷1350', H: 36.1, I: '1151B', J: day(28, 10) },
    // 7: другой элемент (TIP 1f)
    { A: day(2), C: po08, D: 'TIP 1f', F: '92/8752-P-1f-26;27;28', H: 30.1, I: '1158B', J: day(3) },
    // 8: подходит, серии рапорта нет
    { A: day(1, 1), C: po08, D: 'TIP 1', F: '92/8752-P-1-1351÷1378', H: 33.3, I: '1158B', J: day(3) },
    // 9: другой мост (PO 01)
    { A: day(2), C: 'PREDALE POD \nPO 01', D: 'TIP 1', F: '92/8752-P-1-1÷20', H: 40, I: '1159B', J: day(3) },
    // 10: результат ещё не разделён и без бюллетеня — пропускается
    { A: day(3), C: po08, D: 'TIP 1', F: '92/8752-P-1-1379÷1400', H: '34.8\n1145B/3 0.10.2026' },
    // 11: подходит, с серией рапорта (628 в 620÷640)
    { C: po08, D: 'TIP 1', F: '92/8752-P-1-620÷640', H: 35, I: '1200B', J: day(31, 10) },
  ]
  rows.forEach((values, i) => {
    for (const [column, value] of Object.entries(values)) ws.getCell(`${column}${6 + i}`).value = value
  })
  await wb.xlsx.writeFile(file)
}

/** Папка с таблицей лаборатории, папкой рапортов (старый и новый рапорт) и подписью. */
async function workspace(report: Parameters<typeof betsyDocx>[0] = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somasync-betsy-'))
  const lab = path.join(dir, 'Laborator.xlsx')
  await writeLaborator(lab)
  const reports = path.join(dir, 'Rapoarte')
  fs.mkdirSync(reports)
  const old = path.join(reports, 'A_old.docx')
  fs.writeFileSync(old, await betsyDocx({ code: 'C2' }))
  fs.utimesSync(old, new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2026, 10, 1)))
  const latest = path.join(reports, 'Betsy_report.docx')
  fs.writeFileSync(latest, await betsyDocx(report))
  const signature = path.join(dir, 'laborator.png')
  fs.writeFileSync(signature, png(40, 10))
  return { dir, lab, reports, old, latest, signature }
}

/** «Запись»: рапорт — как у главного процесса (`resolveBetsyReport`: директория — её последний рапорт), затем движок. */
async function write(f: { dir: string; lab: string }, source: string, signature = '') {
  const found = await resolveBetsyReport(source, !fs.statSync(source).isDirectory())
  assert.ok('file' in found, 'рапорт найден')
  return runEngine(f.dir, ['--laborator', '--betsy', '--apply', f.lab, found.file], signature ? { SIGNATURE: signature } : {})
}

const open = async (file: string) => BetsyReport.open(fs.readFileSync(file))

// ── Тесты ────────────────────────────────────────────────────────────────────

test('элемент: «COD ELEMENT» = конец названия + символ; серии и диапазоны; номер проекта в начале серии', () => {
  assert.equal(sameElement('PO08-TIP1', 'PREDALE POD \nPO 08', 'TIP 1'), true)
  assert.equal(sameElement('PO08-TIP1', 'PREDALE POD PO 08', 'TIP 1f'), false)
  assert.equal(sameElement('PO08-TIP1', 'PREDALE POD PO 01', 'TIP 1'), false)
  assert.equal(sameElement('C2', 'CADRU PREFABRICAT', 'C2'), true)
  assert.equal(sameElement('C2', 'CADRU PREFABRICAT', "C2'"), false)
  assert.equal(sameElement('', 'CADRU', 'C2'), false)
  assert.equal(seriesContains('92/8752-P-1-628÷650', '628'), true)
  assert.equal(seriesContains('92/8752-P-1-628÷650', '651'), false)
  assert.equal(seriesContains('92/8752-P-1f- 26;27;28', '27'), true)
  assert.equal(seriesContains('133/2022-ZP 1-405;406;407', '406'), true)
  assert.equal(seriesContains('STD-C2-71;72', ''), false)
  assert.equal(sameProject('92/8752-P-1-628÷650', '92/8752'), true)
  assert.equal(sameProject('92/87521-P-1', '92/8752'), false)
  assert.equal(sameProject('STD-C2-71', '92/8752'), false)
  assert.equal(valueLabel(34), '34.0')
  assert.equal(valueLabel(33.3), '33.3')
  assert.equal(valueLabel(33.25), '33.25')
})

test('рабочие дни: выходные не в счёт', () => {
  assert.equal(isWeekend(day(31, 10)), true)
  assert.equal(isWeekend(day(2)), false)
  assert.equal(workdaysBetween(day(30, 10), day(2)), 1, 'пятница → понедельник')
  assert.equal(workdaysBetween(day(31, 10), day(2)), 1, 'суббота → понедельник')
  assert.equal(workdaysBetween(day(3), day(3)), 0)
  assert.equal(workdaysBetween(day(28, 10), day(3)), 4)
  assert.equal(workdaysBetween(day(2), day(16)), 10, 'две недели')
  assert.equal(workdaysBetween(day(3), day(28, 10)), -4)
  assert.deepEqual(workdaysBefore(day(3), 3), day(29, 10), 'вт 03.11 → чт 29.10')
  assert.deepEqual(workdaysBefore(day(2), 3), day(28, 10), 'пн 02.11 → ср 28.10')
  assert.deepEqual(workdaysBefore(day(4), 3), day(30, 10), 'ср 04.11 → пт 30.10')
  assert.deepEqual(workdaysBefore(day(9), 0), day(9), '0 дней — только сам день')
})

test('даты рапорта, размер PNG, последний рапорт папки (замки Word и скрытые — мимо)', () => {
  assert.deepEqual(parseReportDate('03/11/2026'), day(3))
  assert.equal(parseReportDate('31/02/2026'), null)
  assert.equal(parseReportDate('—'), null)
  assert.equal(dateLabel(day(3), '/'), '03/11/2026')
  assert.deepEqual(pngSize(png(40, 10)), { width: 40, height: 10 })
  assert.equal(pngSize(Buffer.from('not a png at all, really not')), null)
  assert.deepEqual(['a.docx', '~$b.docx', '.c.docx', 'd.pdf', 'e.DOCX'].filter(isReportName), ['a.docx', 'e.DOCX'])
  assert.equal(latestReport([{ name: 'a.docx', mtimeMs: 1 }, { name: 'e.DOCX', mtimeMs: 5 }, { name: 'b.docx', mtimeMs: 5 }]), 'e.DOCX')
  assert.equal(latestReport([]), null)
})

test('рапорт: элемент из рамок, строка 6; запись и повторная запись заменяют записанное', async () => {
  const doc = await BetsyReport.open(await betsyDocx())
  assert.deepEqual(doc.element, { code: 'PO08-TIP1', serie: '628', project: '92/8752', castText: '03/11/2026', cast: day(3) })
  assert.deepEqual(doc.lab, { value: null, date: '24/11/2026', signed: false })
  await doc.fill({ value: '33.3', date: '03/11/2026', signature: { png: png(40, 10), width: 40, height: 10 } })
  const once = await BetsyReport.open(await doc.toBytes())
  assert.deepEqual(once.lab, { value: '33.3', date: '03/11/2026', signed: true })
  await once.fill({ value: '35.0', date: '02/11/2026', signature: { png: png(40, 10), width: 40, height: 10 } })
  const bytes = await once.toBytes()
  const twice = await BetsyReport.open(bytes)
  assert.deepEqual(twice.lab, { value: '35.0', date: '02/11/2026', signed: true })
  const zip = await JSZip.loadAsync(bytes)
  const xml = await zip.file('word/document.xml')!.async('string')
  assert.equal(xml.match(/<w:drawing>/g)?.length, 1, 'одна подпись')
  assert.equal(xml.match(/<w:b\/>/g), null, 'прочность — без жирного, как текст строки')
  assert.match(xml, /decofrare <\/w:t><\/w:r><w:r><w:rPr><w:rStyle w:val="CharacterStyle13"\/><\/w:rPr><w:t xml:space="preserve">35\.0<\/w:t><\/w:r><w:r><w:rPr><w:rStyle w:val="CharacterStyle13"\/><\/w:rPr><w:t xml:space="preserve"> N\/mm2/)
  assert.ok(zip.file('word/media/somasync-signature.png'))
  assert.match(await zip.file('[Content_Types].xml')!.async('string'), /Extension="png"/)
  assert.equal((await zip.file('word/_rels/document.xml.rels')!.async('string')).match(/media\/somasync-signature\.png/g)?.length, 1)
})

test('рапорт другого вида — ошибка с причиной', async () => {
  await assert.rejects(BetsyReport.open(await betsyDocx({ row6: false })), (e: Error & { msg?: { code: string } }) => e.msg?.code === 'betsy.noLabRow')
  await assert.rejects(BetsyReport.open(Buffer.from('not a zip')), (e: Error & { msg?: { code: string } }) => e.msg?.code === 'betsy.notDocx')
})

test('запись: последний рапорт папки, строка с серией рапорта, копии обоих файлов, таблица не меняется', async () => {
  const f = await workspace()
  const labBefore = fs.readFileSync(f.lab)
  const oldBefore = fs.readFileSync(f.old)
  const { code, summary } = await write(f, f.reports, f.signature)
  assert.equal(code, 0)
  assert.equal(summary.error, null)
  assert.equal(runOutcome(summary, code), 'wrote')
  assert.equal(summary.verified, true)
  assert.deepEqual(summary.betsy, {
    report: 'Betsy_report.docx', element: 'PO08-TIP1', serie: '628', cast: '03/11/2026',
    row: 11, value: '35.0', bulletin: '1200B', date: '31.10.2026', signature: 'laborator.png', others: 1,
  })
  assert.deepEqual((await open(f.latest)).lab, { value: '35.0', date: '31/10/2026', signed: true })
  assert.deepEqual(fs.readFileSync(f.lab), labBefore, 'таблица лаборатории не меняется')
  assert.deepEqual(fs.readFileSync(f.old), oldBefore, 'старый рапорт не трогается')
  assert.equal(fs.readdirSync(path.join(f.dir, 'backup', 'Laborator')).length, 1)
  assert.deepEqual(fs.readdirSync(path.join(f.reports, 'backup', 'Betsy')), [`${summary.backup}_Betsy_report.docx`])
})

test('запись: без серии — самая поздняя «Data»; без подписи — предупреждение, рапорт без подписи', async () => {
  const f = await workspace({ serie: '' })
  const { code, summary } = await write(f, f.latest)
  assert.equal(code, 0)
  assert.equal(summary.betsy?.row, 8)
  assert.equal(summary.betsy?.value, '33.3')
  assert.equal(summary.betsy?.signature, null)
  assert.ok(summary.warnings.some((w) => w.code === 'betsy.noSignature'))
  assert.deepEqual((await open(f.latest)).lab, { value: '33.3', date: '03/11/2026', signed: false })
})

test('запись не выполняется: нет строки в таблице, рапорт открыт в Word', async () => {
  const f = await workspace({ cast: '20/11/2026' })
  const before = fs.readFileSync(f.latest)
  const none = await write(f, f.reports, f.signature)
  assert.equal(none.code, 1)
  assert.deepEqual(none.summary.error, { code: 'betsy.noLabEntry', params: { code: 'PO08-TIP1', from: '17.11.2026', to: '20.11.2026' } })
  assert.deepEqual(fs.readFileSync(f.latest), before)

  const g = await workspace()
  fs.writeFileSync(path.join(g.reports, '~$tsy_report.docx'), '')
  const opened = await write(g, g.reports, g.signature)
  assert.equal(opened.code, 1)
  assert.equal(opened.summary.error?.code, 'betsy.open')
})

test('какой рапорт: директория — последний, вручную — сам файл; иначе — почему нет', async () => {
  const f = await workspace()
  assert.deepEqual(await resolveBetsyReport(f.reports, false), { file: f.latest })
  assert.deepEqual(await resolveBetsyReport(f.old, true), { file: f.old })
  assert.deepEqual(await resolveBetsyReport(f.old, false), { error: { code: 'check.betsyNotDir' } })
  assert.deepEqual(await resolveBetsyReport(f.reports, true), { error: { code: 'check.betsyNotFile' } })
  const nope = path.join(f.dir, 'nope')
  assert.deepEqual(await resolveBetsyReport(nope, false), { error: { code: 'betsy.notFound', params: { path: nope } } })
  const empty = path.join(f.dir, 'Empty')
  fs.mkdirSync(empty)
  fs.writeFileSync(path.join(empty, '~$tsy_report.docx'), '')
  assert.deepEqual(await resolveBetsyReport(empty, false), { error: { code: 'betsy.noReports', params: { dir: empty } } })
})

test('параметры: --laborator --betsy <таблица> <рапорт|папка>', () => {
  const o = parseEngineOptions(['--laborator', '--betsy', '--apply', '/t/Laborator.xlsx', '/r/Rapoarte'], {})
  assert.equal(o.command, 'betsy-write')
  assert.deepEqual(o.desk, { kind: 'laborator', file: '/t/Laborator.xlsx' })
  assert.equal(o.betsy, '/r/Rapoarte')
})

test('настройки: директория и рапорт — свои у каждого места хранения, источник — по месту хранения рабочего места', () => {
  assert.deepEqual(parseSettings({}).betsy, DEFAULT_SETTINGS.betsy)
  const s: AppSettings = parseSettings({
    target: 'googleDrive',
    desks: { laborator: { target: 'smb' } },
    betsy: { manual: false, dirs: { local: '/l', smb: '/Volumes/Atelier/Betsy', googleDrive: '/g' }, files: { smb: '/Volumes/Atelier/Betsy/r.docx', local: 5 } },
  })
  assert.deepEqual(s.betsy.files, { local: '', smb: '/Volumes/Atelier/Betsy/r.docx', googleDrive: '' })
  assert.equal(betsySource(s, 'laborator'), '/Volumes/Atelier/Betsy')
  assert.equal(betsySource(s, 'atelier'), '/g')
  assert.equal(betsySource({ ...s, betsy: { ...s.betsy, manual: true } }, 'laborator'), '/Volumes/Atelier/Betsy/r.docx')
})

test('«Хранилище»: директория — её последний рапорт и элемент; рапорт вручную; файл вместо директории', async () => {
  const f = await workspace()
  const settings = { getSnapshot: () => DEFAULT_SETTINGS }
  const storage = new StorageService(settings as never, null as never, null as never)
  const dir = await storage.checkBetsy(f.reports, false)
  assert.equal(dir.ok, true)
  assert.deepEqual(dir.msg, { code: 'check.betsyLatest', params: { file: 'Betsy_report.docx', code: 'PO08-TIP1', serie: '628', cast: '03/11/2026' } })
  assert.deepEqual((await storage.checkBetsy(f.old, true)).msg, { code: 'check.betsyReport', params: { file: 'A_old.docx', code: 'C2', serie: '628', cast: '03/11/2026' } })
  assert.deepEqual((await storage.checkBetsy(f.old, false)).msg, { code: 'check.betsyNotDir' })
  assert.deepEqual((await storage.checkBetsy(f.reports, true)).msg, { code: 'check.betsyNotFile' })
  assert.deepEqual((await storage.checkBetsy(path.join(f.dir, 'nope'), false)).msg, { code: 'betsy.notFound', params: { path: path.join(f.dir, 'nope') } })
})

test('«Запись» у цеха и контроля качества: пока не настроена — предупреждение, движок не запускается', async () => {
  const { SyncService } = await import('../src/host/SyncService')
  for (const workplace of ['atelier', 'calitate'] as const) {
    const events: Array<{ level: string; code: string }> = []
    const journal = { event: (level: string, msg: { code: string }) => events.push({ level, code: msg.code }) }
    const runner = { run: () => assert.fail('движок не должен запускаться') }
    const sync = new SyncService({ getSnapshot: () => ({ ...DEFAULT_SETTINGS, workplace }) } as never, journal as never, runner as never)
    assert.deepEqual(await sync.writeBetsy(), { ok: false, error: { code: 'betsy.notConfigured' } })
    assert.deepEqual(events, [{ level: 'warn', code: 'betsy.notConfigured' }])
  }
})

test('запись: окно по рабочим дням — «Data» в среду подходит к «TURNAT LA» в понедельник (5 календарных дней)', async () => {
  const f = await workspace({ serie: '', cast: '02/11/2026' })
  const { code, summary, text } = await write(f, f.latest)
  assert.equal(code, 0)
  // подходят строка 11 (сб 31.10) и строка 6 (ср 28.10); строка 8 (вт 03.11) — позже «TURNAT LA»
  assert.equal(summary.betsy?.row, 11)
  assert.equal(summary.betsy?.others, 1)
  assert.match(text, /\(1\): 6 /)
})
