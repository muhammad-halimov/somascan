/**
 * Движок целиком на синтетических книгах: план, запись, проверка после записи, повторный прогон,
 * отложенная запись при открытом файле.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { ConsumBook } from '../src/engine/books/ConsumBook'
import { ProbeBook } from '../src/engine/books/ProbeBook'
import { SarjeleBook } from '../src/engine/books/SarjeleBook'
import { parseEngineOptions } from '../src/engine/EngineOptions'
import { MemorySink } from '../src/engine/RunReport'
import { SyncEngine } from '../src/engine/SyncEngine'
import { ENGINE_EXIT, type RunSummary } from '../src/shared/protocol'
import { makeWorkspace, PROJECT, writeConsum, type Workspace } from './fixtures'

/** Запускает движок с аргументами. */
async function run(ws: Workspace, args: string[], env: NodeJS.ProcessEnv = {}) {
  const reporter = new MemorySink()
  const jsonOut = path.join(ws.dir, `out-${Date.now()}-${Math.random()}.json`)
  const options = parseEngineOptions([...args, ws.consum, ws.sarjele, ws.probe], { ...ws.env, ...env, JSON_OUT: jsonOut }, new Date(2026, 9, 19))
  const code = await new SyncEngine(options, reporter, new Date(2026, 9, 19)).run()
  const json = fs.existsSync(jsonOut) ? (JSON.parse(fs.readFileSync(jsonOut, 'utf8')) as RunSummary) : null
  return { code, reporter, json, text: reporter.lines.join('\n'), warnings: reporter.warnings.join('\n') }
}

test('план без --apply ничего не меняет', async () => {
  const ws = await makeWorkspace()
  const before = fs.readFileSync(ws.sarjele)
  const r = await run(ws, [])
  assert.equal(r.code, ENGINE_EXIT.ok)
  assert.match(r.text, /■ PROIECT TEST \/ EL-1 \(Buc 2\) — ДОЗАПОЛНИТЬ блок/)
  assert.match(r.text, /■ PROIECT TEST \/ EL-2 \(Buc 4\) — СОЗДАТЬ блок/)
  assert.match(r.text, /dry-run/)
  assert.deepEqual(fs.readFileSync(ws.sarjele), before)
  assert.ok(!fs.existsSync(path.join(ws.dir, 'backups')))
})

test('запись: блоки, ID в Consum, плавки, проверка после записи', async () => {
  const ws = await makeWorkspace()
  const r = await run(ws, ['--apply'])
  assert.equal(r.code, ENGINE_EXIT.ok, r.warnings)
  assert.match(r.text, /✔ Sarjele обновлён \(блоков: 2, привязок: 2\)/)
  assert.match(r.text, /✔ Consum: записано ID — 2/)
  assert.match(r.text, /✔ Проверка после записи/)
  assert.equal(r.json?.verified, true)
  assert.equal(r.json?.wrote, true)
  assert.deepEqual(r.json?.blocks.map((b) => [b.element, b.mode, b.kg]), [['EL-1', 'fill', 300], ['EL-2', 'create', 200]])
  assert.deepEqual(r.json?.closed, ['H300'])
  assert.ok(r.json?.backup, 'метка бэкапа в итоге')
  assert.ok(r.json?.consumAfter, 'Consum после записи ID — для слежения')
  assert.ok(fs.readdirSync(path.join(ws.dir, 'backups')).length >= 3, 'бэкапы всех трёх файлов')

  const sj = await SarjeleBook.read(ws.sarjele)
  assert.equal(sj.used.get('H100'), 300)
  assert.equal(sj.used.get('H300'), 200)
  const ids = sj.blocks.filter((b) => b.sheet === PROJECT).map((b) => b.id).sort()
  assert.deepEqual(ids, ['PT-0001', 'PT-0002'])
  assert.equal(sj.registry.size, 2)

  const probe = await ProbeBook.read(ws.probe, { sheets: ['2026'], explicit: true, year: 2026 })
  assert.equal(probe.heats.get('H300')!.closed, true, 'H300 израсходована полностью — закрашена')
  assert.equal(probe.heats.get('H100')!.closed, false)

  const consum = await ConsumBook.read(ws.consum, () => PROJECT)
  assert.deepEqual(consum.items.map((i) => i.id).sort(), ['PT-0001', 'PT-0002'])
})

test('повторный прогон без изменений Consum ничего не пишет', async () => {
  const ws = await makeWorkspace()
  await run(ws, ['--apply'])
  const before = fs.statSync(ws.sarjele).mtimeMs
  const backups = fs.readdirSync(path.join(ws.dir, 'backups')).length
  const r = await run(ws, ['--apply'])
  assert.equal(r.code, ENGINE_EXIT.ok)
  assert.doesNotMatch(r.text, /Бэкап:/)
  assert.equal(fs.statSync(ws.sarjele).mtimeMs, before)
  assert.equal(fs.readdirSync(path.join(ws.dir, 'backups')).length, backups)
})

test('расход в Consum вырос — блок дописывается, остаток пересчитывается', async () => {
  const ws = await makeWorkspace()
  await run(ws, ['--apply'])
  // ID уже в Consum: перепишем Consum с теми же ID, но большим расходом EL-1
  const consum = await ConsumBook.read(ws.consum, () => PROJECT)
  await writeConsum(ws.consum, [
    { name: 'EL-1', buc: 3, bob8: 450 },
    { name: 'EL-2', buc: 4, bar10: 200 },
  ])
  // вернуть ID в колонку (новая книга их не содержит)
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(ws.consum)
  const sheet = wb.getWorksheet('Decont Lunar')!
  for (const it of consum.items) sheet.getCell(it.row, 41).value = it.id
  await wb.xlsx.writeFile(ws.consum)

  const r = await run(ws, ['--apply'])
  assert.equal(r.code, ENGINE_EXIT.ok, r.warnings)
  assert.match(r.text, /■ PROIECT TEST \/ EL-1 \(Buc 3\) — ИЗМЕНИТЬ блок/)
  const sj = await SarjeleBook.read(ws.sarjele)
  assert.equal(sj.used.get('H100'), 450)
  assert.equal(r.json?.verified, true)
})

test('Sarjele открыт в редакторе — запись отложена (код 3), файл не тронут', async () => {
  const ws = await makeWorkspace()
  const lock = path.join(ws.dir, '.~lock.Sarjele.xlsx#')
  fs.writeFileSync(lock, '')
  const before = fs.readFileSync(ws.sarjele)
  const r = await run(ws, ['--apply'])
  assert.equal(r.code, ENGINE_EXIT.deferred)
  assert.match(r.warnings, /Запись отложена: «Sarjele\.xlsx» открыт/)
  assert.deepEqual(fs.readFileSync(ws.sarjele), before)
  assert.deepEqual(r.json!.deferred.map((d) => d.lockFile), [lock])
  // GUARD_OPEN_FILES=0 — пишет несмотря на замок
  const forced = await run(ws, ['--apply'], { GUARD_OPEN_FILES: '0' })
  assert.equal(forced.code, ENGINE_EXIT.ok)
  assert.match(forced.text, /✔ Sarjele обновлён/)
})

test('Consum открыт в Excel — Sarjele пишется, ID откладываются', async () => {
  const ws = await makeWorkspace()
  fs.writeFileSync(path.join(ws.dir, '~$Consum.xlsx'), '')
  const r = await run(ws, ['--apply'])
  assert.equal(r.code, ENGINE_EXIT.deferred)
  assert.match(r.text, /✔ Sarjele обновлён/)
  assert.match(r.text, /Consum открыт — 2 ID будут записаны при следующем запуске/)
  const consum = await ConsumBook.read(ws.consum, () => PROJECT)
  assert.deepEqual(consum.items.map((i) => i.id), ['', ''])
})

test('откат возвращает файлы к бэкапу', async () => {
  const ws = await makeWorkspace()
  const original = fs.readFileSync(ws.sarjele)
  await run(ws, ['--apply'])
  const stamp = fs.readdirSync(path.join(ws.dir, 'backups'))[0]!.split('_')[0]!
  const reporter = new MemorySink()
  const code = await new SyncEngine(parseEngineOptions(['--restore', stamp, ws.sarjele, ws.probe, ws.consum], ws.env), reporter).run()
  assert.equal(code, ENGINE_EXIT.ok)
  assert.match(reporter.lines.join('\n'), /Восстановлено состояние/)
  assert.deepEqual(fs.readFileSync(ws.sarjele), original)
})

test('links.json испорчен — прогон не выполняется, файлы не тронуты', async () => {
  const ws = await makeWorkspace()
  fs.writeFileSync(ws.links, '{ "PROIECT TEST|EL-2": "@skip", }')
  const before = fs.readFileSync(ws.sarjele)
  const r = await run(ws, ['--apply'])
  assert.equal(r.code, ENGINE_EXIT.error)
  assert.equal(r.json?.error?.code, 'error.linksBroken')
  assert.deepEqual(fs.readFileSync(ws.sarjele), before)
  fs.writeFileSync(ws.links, '["@skip"]')
  assert.equal((await run(ws, [])).json?.error?.code, 'error.linksNotObject')
})

test('links.json: @skip с BOM и в другом регистре, неверные строки — с предупреждением', async () => {
  const ws = await makeWorkspace()
  fs.writeFileSync(ws.links, '﻿{ "proiect test|el-2 ": " @SKIP ", "без черты": "@new", "PROIECT TEST|EL-1": 5 }')
  const r = await run(ws, [])
  assert.equal(r.code, ENGINE_EXIT.ok)
  assert.deepEqual(r.json?.skipped.map((s) => [s.element, s.reason.code]), [['EL-2', 'skip.manual']])
  assert.deepEqual(r.json?.warnings.map((w) => w.code), ['warn.linksBadKey', 'warn.linksBadValue'])
  assert.match(r.text, /■ PROIECT TEST \/ EL-1/)
})

test('links.json: блока с таким заголовком нет или команда неизвестна — элемент пропускается, нового блока нет', async () => {
  const ws = await makeWorkspace()
  fs.writeFileSync(ws.links, JSON.stringify({ 'PROIECT TEST|EL-1': 'EL-1 с опечаткой', 'PROIECT TEST|EL-2': '@neww' }))
  const r = await run(ws, [])
  assert.deepEqual(r.json?.skipped.map((s) => s.reason.code), ['skip.linkNotFound', 'skip.linkUnknown'])
  assert.equal(r.json?.blocks.length, 0)
})
