/**
 * Движок очереди выгрузки в «голом» JS-контексте (как JavaScriptCore на iOS): загрузка без
 * браузерных API, запись на сетевой диск и в Google Drive, перезапуск посреди записи (оборванная
 * запись и своя блокировка), нет таблицы, отмена. Запуск: `npm test` (движок собирается Vite).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, test } from 'node:test'
import type { StorageSettings } from '../src/features/settings/store/settingsSchema'
import type { UploadRecord } from '../src/features/uploads/store/UploadStore'
import { LabelWorkbook } from '../src/features/uploads/xlsx/LabelWorkbook'
import type { UploadColumn } from '../src/features/uploads/xlsx/uploadColumns'
import { EngineHarness, buildEngine } from './engineHarness'
import { FakeDrive } from './fakeDrive'
import { FakeSmb } from './fakeSmb'

/** Пустой журнал с листом `2026`. */
const template = new Uint8Array(readFileSync(new URL('./fixtures/Probe otel.xlsx', import.meta.url)))
const TABLE = 'Probe si Sarje Otel/Probe otel.xlsx'
const columns: UploadColumn[] = [
  { key: 'heat', kind: 'code', header: 'Плавка', aliases: ['heat'] },
  { key: 'producer', kind: 'text', header: 'Производитель', aliases: ['producer'] },
]
const smbStorage: StorageSettings = {
  target: 'smb',
  smb: { host: '10.0.0.5', share: 'Warehouse', filePath: 'Probe si Sarje Otel\\Probe otel.xlsx', domain: '', username: 'scan', password: 'x' },
  googleDrive: { account: '', folder: '', fileName: 'Probe otel.xlsx' },
}
const record = (n: number): UploadRecord => ({
  id: `id-${n}`, createdAt: Date.now() + n, localNumber: `SCN-261009-000${n}`,
  label: { heat: `H${n}`, producer: 'Sovel', product_form: 'bobina', size: '10 mm', weight_kg: 1000 + n },
  columns, status: 'queued', attempts: 0,
})
const statusOf = (engine: EngineHarness, id: string) => engine.records.find((item) => item.id === id)?.status

let code = ''
before(async () => {
  code = await buildEngine()
})

test('движок грузится без браузерных API и сообщает о готовности', () => {
  const engine = new EngineHarness(code, {})
  try {
    for (const name of ['setTimeout', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'AbortController', 'window', 'URLSearchParams', 'Blob', 'fetch']) {
      assert.ok(engine.missingBefore.includes(name), `${name} отсутствует в контексте`)
    }
    assert.equal(engine.events[0]?.type, 'ready')
    assert.deepEqual(engine.activity, { running: false, online: true, due: 0, waiting: 0, nextAttemptAt: null, pending: 0, failed: 0, progress: { done: 0, total: 0, current: 0 }, finished: null })
  } finally {
    engine.stop()
  }
})

test('бирка пишется на сетевой диск, активность возвращается в покой', async () => {
  const smb = new FakeSmb()
  smb.put(TABLE, template)
  const engine = new EngineHarness(code, { smb })
  try {
    engine.command({ type: 'configure', storage: smbStorage, deviceId: 'ios-a1b2c3d4' })
    engine.command({ type: 'enqueue', record: record(1) })
    await engine.until(() => statusOf(engine, 'id-1') === 'completed')
    const done = engine.records.find((item) => item.id === 'id-1')!
    assert.equal(done.rowNumber, 7)
    assert.equal(done.item, 1, 'номер элемента в журнале')
    assert.equal((await LabelWorkbook.open(smb.file(TABLE)!)).locate('SCN-261009-0001')?.row, 7)
    await engine.until(() => engine.activity?.running === false && engine.activity.pending === 0)
    assert.ok(engine.events.some((event) => event.type === 'activity' && event.activity.running), 'была активность «пишет»')
  } finally {
    engine.stop()
  }
})

test('ход пачки: обработано из всех растёт по одной, в покое — 0 из 0', async () => {
  const smb = new FakeSmb()
  smb.put(TABLE, template)
  const engine = new EngineHarness(code, { smb })
  try {
    engine.command({ type: 'configure', storage: smbStorage, deviceId: 'ios-a1b2c3d4' })
    engine.command({ type: 'import', records: [record(1), record(2), record(3)] })
    await engine.until(() => engine.records.length === 3 && engine.records.every((item) => item.status === 'completed'))
    await engine.until(() => engine.activity?.running === false && engine.activity.pending === 0)
    const seen = engine.events.flatMap((event) => (event.type === 'activity' && event.activity.progress.total > 0 ? [`${event.activity.progress.done}/${event.activity.progress.total}`] : []))
    assert.deepEqual([...new Set(seen)], ['0/3', '1/3', '2/3', '3/3'])
    assert.deepEqual(engine.activity?.progress, { done: 0, total: 0, current: 0 })
    // Внутри записи бирки ход тоже идёт: шаги записи (блокировка, чтение, подготовка, замена, проверка).
    const steps = engine.events.flatMap((event) => (event.type === 'activity' && event.activity.progress.done === 0 && event.activity.progress.current > 0 ? [event.activity.progress.current] : []))
    assert.deepEqual([...new Set(steps)], [0.1, 0.35, 0.55, 0.8, 0.95])
    assert.deepEqual(engine.activity?.finished, { written: 3, total: 3 }, 'итог пачки: записаны все')
  } finally {
    engine.stop()
  }
})

test('перезапуск посреди записи: оборванная запись и своя блокировка не мешают дописать очередь', async () => {
  const smb = new FakeSmb()
  smb.put(TABLE, template)
  const storage = new Map<string, string>()
  const first = new EngineHarness(code, { smb, storage })
  first.command({ type: 'configure', storage: smbStorage, deviceId: 'android-11111111' })
  // Запись дошла до блокировки — и процесс убили (приложение закрыли).
  smb.beforeOperation = (op, path) => {
    if (op === 'read' && path === TABLE) {
      first.stop()
      smb.beforeOperation = undefined
    }
  }
  first.command({ type: 'enqueue', record: record(1) })
  first.command({ type: 'enqueue', record: record(2) })
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.ok(smb.nodes.has(`${TABLE}.lock`), 'блокировка осталась на сервере')
  assert.match(storage.get('somascan.uploads.v2') ?? '', /"uploading"/, 'в сохранённой очереди запись «пишется»')

  // Новый процесс (фоновая работа или открытие приложения) поднимает движок с тем же хранилищем.
  const second = new EngineHarness(code, { smb, storage })
  try {
    await second.until(() => second.records.length === 2 && second.records.every((item) => item.status === 'completed'))
    assert.ok(!second.records.some((item) => item.error?.code === 'busy'), 'без «таблицу пишет другое устройство»')
    assert.equal(smb.nodes.has(`${TABLE}.lock`), false)
    const workbook = await LabelWorkbook.open(smb.file(TABLE)!)
    assert.deepEqual([workbook.locate('SCN-261009-0001')?.row, workbook.locate('SCN-261009-0002')?.row].sort(), [7, 8])
  } finally {
    second.stop()
  }
})

test('нет таблицы — запись ждёт пользователя (tableNotFound), на сервере ничего не создано', async () => {
  const smb = new FakeSmb()
  const engine = new EngineHarness(code, { smb })
  try {
    engine.command({ type: 'configure', storage: smbStorage, deviceId: 'ios-a1b2c3d4' })
    engine.command({ type: 'enqueue', record: record(1) })
    await engine.until(() => statusOf(engine, 'id-1') === 'failed')
    assert.equal(engine.records[0]!.error?.code, 'tableNotFound')
    assert.deepEqual([...smb.nodes.keys()], [])
    assert.equal(engine.activity?.failed, 1)
    await engine.until(() => engine.activity?.running === false)
    assert.deepEqual(engine.activity?.finished, { written: 0, total: 1 }, 'итог пачки: не записана')
  } finally {
    engine.stop()
  }
})

test('Google Drive: токен и HTTP через хост, запись в существующую таблицу', async () => {
  const drive = new FakeDrive()
  drive.add({ id: 'folder1AbCdEfGh', name: 'Somascan', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] })
  drive.add({ name: 'Probe otel.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', parents: ['folder1AbCdEfGh'], bytes: template })
  const engine = new EngineHarness(code, { drive, token: 'token' })
  try {
    engine.command({
      type: 'configure',
      storage: { ...smbStorage, target: 'googleDrive', googleDrive: { account: 'lab@example.com', folder: 'folder1AbCdEfGh', fileName: 'Probe otel.xlsx' } },
      deviceId: 'ios-a1b2c3d4',
    })
    engine.command({ type: 'enqueue', record: record(3) })
    await engine.until(() => statusOf(engine, 'id-3') === 'completed')
    const table = drive.childrenOf('folder1AbCdEfGh').find((file) => file.name === 'Probe otel.xlsx')!
    assert.equal((await LabelWorkbook.open(table.bytes)).locate('SCN-261009-0003')?.row, 7)
  } finally {
    engine.stop()
  }
})

test('отмена ждущей записи и перенос прежней очереди экрана', async () => {
  const engine = new EngineHarness(code, {})
  try {
    engine.command({ type: 'import', records: [{ ...record(5), status: 'completed', completedAt: Date.now(), rowNumber: 9 }, { ...record(6), status: 'failed', error: { code: 'authFailed', at: Date.now() } }] })
    await engine.until(() => engine.records.length === 2)
    engine.command({ type: 'cancel', id: 'id-6' })
    await engine.until(() => engine.records.length === 1)
    assert.equal(engine.records[0]!.id, 'id-5')
    engine.command({ type: 'clearCompleted' })
    await engine.until(() => engine.records.length === 0)
  } finally {
    engine.stop()
  }
})
