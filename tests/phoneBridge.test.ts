/**
 * Мост с телефонами в главном процессе (`PhoneBridge`) на поддельном Drive, движок — в этом же процессе:
 * копии нет — создаётся из Probe; телефон дописал копию — бирка переносится в Probe, Probe ложится на место копии;
 * изменился только Probe — выкладывается без прогона; Probe открыт в Excel — копия не заменяется, перенос — после
 * закрытия; не работает без слежения с записью.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { parseEngineOptions } from '../src/engine/EngineOptions'
import type { UploadColumn } from '../src/engine/lab/labelValues'
import { LabelWorkbook, type LabEntry } from '../src/engine/lab/LabelWorkbook'
import { MemorySink } from '../src/engine/RunReport'
import { SyncEngine } from '../src/engine/SyncEngine'
import type { AppPaths } from '../src/host/AppPaths'
import type { DriveClient } from '../src/host/drive/DriveClient'
import type { DriveService } from '../src/host/drive/DriveService'
import type { Journal } from '../src/host/Journal'
import { PhoneBridge, POLL_MS } from '../src/host/PhoneBridge'
import type { SettingsStore } from '../src/host/SettingsStore'
import type { SyncService } from '../src/host/SyncService'
import type { Message } from '../src/shared/messages'
import type { RunState, RunSummary } from '../src/shared/protocol'
import { DEFAULT_SETTINGS, type AppSettings } from '../src/shared/settings'
import { FakeDrive, FOLDER } from './fakeDrive'

const NAME = 'Probe otel.xlsx'
const template = fs.readFileSync(new URL('./fixtures/Probe otel.xlsx', import.meta.url))
const columns: UploadColumn[] = [{ key: 'heat', kind: 'code', header: 'Плавка', aliases: [] }]
const tag = (n: number): LabEntry => ({ localNumber: `SCN-261030-000${n}`, label: { producer: 'Sovel', heat: `H${n}`, size: '12', weight_kg: 2000, product_form: 'bara' }, columns })
const at = new Date(2026, 9, 30, 9).getTime()

/** Дописывает бирку в книгу (как телефон). */
async function withTag(bytes: Uint8Array, n: number): Promise<Uint8Array> {
  const book = await LabelWorkbook.open(bytes)
  book.append(tag(n), at)
  return book.toBytes()
}

/** Есть ли бирка в книге. */
const has = async (bytes: Uint8Array, n: number) => (await LabelWorkbook.open(bytes)).locate(tag(n).localNumber) !== null

/** Мост с поддельными службами: Drive, настройки, журнал, прогоны (движок — здесь же). */
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somasync-phones-'))
  const probe = path.join(dir, NAME)
  fs.writeFileSync(probe, template)
  const drive = new FakeDrive()
  let now = drive.now
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    bridge: true,
    write: true,
    target: 'smb',
    googleDrive: { account: 'a@b.c', folder: FOLDER, token: '' },
    files: { ...DEFAULT_SETTINGS.files, smb: { consums: [''], sarjele: '', probe } },
  }
  const events: Message[] = []
  const runs: RunSummary[] = []
  const state: RunState = { status: 'watching', busy: null, nextCheckAt: null, lastCheckAt: null, lastRunAt: null, pending: [], bridge: { syncedAt: null, waiting: false, problem: null } }
  const sync = {
    getSnapshot: () => state,
    patch: (patch: Partial<RunState>) => Object.assign(state, patch),
    bridge: async <T>(fn: (engine: (file: string, args: string[]) => Promise<{ code: number; summary: RunSummary | null }>) => Promise<T>) => fn(async (_file, args) => {
      const jsonOut = path.join(dir, 'run.json')
      const code = await new SyncEngine(parseEngineOptions(args, { JSON_OUT: jsonOut, GUARD_OPEN_FILES: '1' }), new MemorySink()).run()
      const summary = JSON.parse(fs.readFileSync(jsonOut, 'utf8')) as RunSummary
      runs.push(summary)
      return { code, summary }
    }),
  }
  const bridge = new PhoneBridge(
    { data: dir } as AppPaths,
    { getSnapshot: () => settings, files: () => settings.files.smb } as unknown as SettingsStore,
    { event: (_level: string, msg: Message) => events.push(msg) } as unknown as Journal,
    sync as unknown as SyncService,
    { client: async () => drive as unknown as DriveClient } as unknown as DriveService,
    () => now,
  )
  /** Следующая проверка (через `POLL_MS`). */
  const tick = async () => {
    now += POLL_MS
    drive.now = now
    await bridge.tick()
  }
  const copy = () => drive.byName(NAME)[0]
  return { dir, probe, drive, settings, state, events, runs, tick, copy }
}

test('копии нет — создаётся из Probe; телефон дописал — бирка в Probe, Probe на месте копии', async () => {
  const t = setup()
  await t.tick()
  assert.ok(t.copy(), 'копия создана')
  assert.ok(Buffer.from(t.copy()!.bytes).equals(fs.readFileSync(t.probe)))
  assert.deepEqual(t.events.map((e) => e.code), ['bridge.created'])
  assert.equal(t.runs.length, 0)
  assert.ok(t.state.bridge.syncedAt)

  // ничего не изменилось — ни прогона, ни выкладки
  const version = t.copy()!.version
  await t.tick()
  assert.equal(t.copy()!.version, version)

  // телефон дописал бирку 1 в копию
  t.drive.edit(t.copy()!.id, await withTag(t.copy()!.bytes, 1))
  await t.tick()
  assert.equal(t.runs.length, 1)
  assert.deepEqual(t.runs[0]!.bridged.map((b) => b.heat), ['H1'])
  assert.ok(await has(fs.readFileSync(t.probe), 1), 'бирка в Probe')
  assert.ok(Buffer.from(t.copy()!.bytes).equals(fs.readFileSync(t.probe)), 'копия = Probe')
  assert.equal(t.drive.byName(`${NAME}.lock`).length, 0, 'блокировка снята')

  // изменился только Probe — выкладывается без прогона
  fs.writeFileSync(t.probe, await withTag(fs.readFileSync(t.probe), 2))
  await t.tick()
  assert.equal(t.runs.length, 1)
  assert.ok(await has(t.copy()!.bytes, 2))
})

test('Probe открыт в Excel — копия не заменяется, бирка ждёт; после закрытия — переносится', async () => {
  const t = setup()
  await t.tick()
  t.drive.edit(t.copy()!.id, await withTag(t.copy()!.bytes, 3))
  const lock = path.join(t.dir, `~$${NAME}`)
  fs.writeFileSync(lock, '')
  await t.tick()
  assert.equal(t.runs.length, 1)
  assert.equal(t.state.bridge.waiting, true)
  assert.ok(await has(t.copy()!.bytes, 3), 'бирка телефона осталась в копии')
  assert.ok(!(await has(fs.readFileSync(t.probe), 3)))

  // пока открыт — даже после сохранения в Excel ни прогона, ни выкладки
  fs.writeFileSync(t.probe, await withTag(fs.readFileSync(t.probe), 4))
  await t.tick()
  assert.equal(t.runs.length, 1)
  assert.ok(await has(t.copy()!.bytes, 3))

  fs.unlinkSync(lock)
  await t.tick()
  assert.equal(t.runs.length, 2)
  assert.equal(t.state.bridge.waiting, false)
  const probe = fs.readFileSync(t.probe)
  assert.ok((await has(probe, 3)) && (await has(probe, 4)))
  assert.ok(Buffer.from(t.copy()!.bytes).equals(probe))
})

test('без слежения, в пробном режиме или с таблицами в Google Drive мост не работает', async () => {
  const t = setup()
  t.state.status = 'idle'
  await t.tick()
  t.state.status = 'watching'
  t.settings.write = false
  await t.tick()
  t.settings.write = true
  t.settings.target = 'googleDrive'
  await t.tick()
  assert.equal(t.copy(), undefined)
})
