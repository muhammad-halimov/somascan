/**
 * Запись таблицы на сетевой диск через поддельную общую папку: нет таблицы — ничего не создаётся,
 * дописывание с копией, блокировки (чужая, брошенная, своя — от оборванной записи).
 * Запуск: `npm test`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { UploadRecord } from '../src/features/uploads/store/UploadStore'
import { SmbTableBackend } from '../src/features/uploads/smb/SmbTableBackend'
import { tablePaths } from '../src/features/uploads/smb/smbSettings'
import { TableWriter } from '../src/features/uploads/worker/TableWriter'
import { LabelWorkbook } from '../src/features/uploads/xlsx/LabelWorkbook'
import type { UploadColumn } from '../src/features/uploads/xlsx/uploadColumns'
import { FakeSmb } from './fakeSmb'

/** Пустой журнал с листом `2026`. */
const template = new Uint8Array(readFileSync(new URL('./fixtures/Probe otel.xlsx', import.meta.url)))
const connection = { host: 'srv', port: 445, share: 'Warehouse', domain: '', username: 'scan', password: '' }
const TABLE = 'Probe si Sarje Otel/Probe otel.xlsx'
const LOCK = `${TABLE}.lock`

const columns: UploadColumn[] = [
  { key: 'heat', kind: 'code', header: 'Плавка', aliases: ['heat'] },
  { key: 'producer', kind: 'text', header: 'Производитель', aliases: ['producer'] },
]
const record = (n: number): UploadRecord => ({
  id: `id-${n}`, createdAt: Date.UTC(2026, 9, 7, 10, n), localNumber: `SCN-261007-000${n}`,
  label: { heat: `H${n}`, producer: 'Sovel', product_form: 'bobina', size: '10 mm', weight_kg: 1000 + n },
  columns, status: 'queued', attempts: 0,
})

/** Писатель устройства `device-a` и таблица на поддельной папке. */
function setup(smb: FakeSmb) {
  const backend = new SmbTableBackend(smb, connection, tablePaths(TABLE), () => smb.now)
  return { backend, writer: new TableWriter('device-a', () => smb.now) }
}

/** Ставит блокировку с владельцем, как её оставило бы устройство. */
function putLock(smb: FakeSmb, owner: string | null, createdAt: number) {
  smb.nodes.set(LOCK, { isDirectory: true, bytes: new Uint8Array(), modifiedAt: createdAt })
  if (owner) smb.nodes.set(`${LOCK}/owner.json`, { isDirectory: false, bytes: new TextEncoder().encode(JSON.stringify({ owner, createdAt })), modifiedAt: createdAt })
}

test('нет таблицы и папки — tableNotFound, на сервере ничего не создано', async () => {
  const smb = new FakeSmb()
  const { backend, writer } = setup(smb)
  await assert.rejects(writer.write(record(1), backend), (error: Error & { code?: string }) => error.code === 'tableNotFound')
  assert.deepEqual([...smb.nodes.keys()], [], 'ни папок, ни блокировки')
  smb.nodes.set('Probe si Sarje Otel', { isDirectory: true, bytes: new Uint8Array(), modifiedAt: smb.now })
  await assert.rejects(writer.write(record(1), backend), (error: Error & { code?: string }) => error.code === 'tableNotFound')
  assert.deepEqual([...smb.nodes.keys()], ['Probe si Sarje Otel'], 'папка есть, таблицы нет — блокировка снята, файлов нет')
})

test('дописывание в существующую таблицу с копией перед каждой записью', async () => {
  const smb = new FakeSmb()
  smb.put(TABLE, template)
  const { backend, writer } = setup(smb)
  assert.equal((await writer.write(record(1), backend)).rowNumber, 7)
  smb.now += 60_000
  assert.equal((await writer.write(record(2), backend)).rowNumber, 8)
  const repeat = await writer.write(record(2), backend)
  assert.deepEqual([repeat.duplicate, repeat.rowNumber, repeat.item], [true, 8, 2], 'повтор — та же строка и номер элемента')
  const workbook = await LabelWorkbook.open(smb.file(TABLE)!)
  assert.deepEqual(workbook.locate('SCN-261007-0002'), { sheet: '2026', row: 8 })
  assert.equal([...smb.nodes.keys()].filter((key) => key.startsWith('Probe si Sarje Otel/backups/')).length, 2)
  assert.equal(smb.nodes.has(LOCK), false, 'блокировка снята')
})

test('чужая свежая блокировка — busy; брошенная (старше 5 минут) — снимается', async () => {
  const smb = new FakeSmb()
  smb.put(TABLE, template)
  const { backend, writer } = setup(smb)
  putLock(smb, 'device-b', smb.now - 60_000)
  await assert.rejects(writer.write(record(1), backend), (error: Error & { code?: string; params?: { owner?: string } }) => error.code === 'busy' && error.params?.owner === 'device-b')
  smb.now += 5 * 60_000
  assert.equal((await writer.write(record(1), backend)).rowNumber, 7)
})

test('своя блокировка от оборванной записи снимается сразу, без «другое устройство пишет»', async () => {
  const smb = new FakeSmb()
  smb.put(TABLE, template)
  const { backend, writer } = setup(smb)
  // Приложение закрыли посреди записи: блокировка этого же устройства осталась на сервере.
  putLock(smb, 'device-a', smb.now - 5_000)
  assert.equal((await writer.write(record(1), backend)).rowNumber, 7)
  assert.equal(smb.nodes.has(LOCK), false)
})

test('блокировка без файла владельца — busy, пока не устареет', async () => {
  const smb = new FakeSmb()
  smb.put(TABLE, template)
  const { backend, writer } = setup(smb)
  putLock(smb, null, smb.now - 30_000)
  await assert.rejects(writer.write(record(1), backend), (error: Error & { code?: string }) => error.code === 'busy')
  smb.now += 5 * 60_000
  assert.equal((await writer.write(record(1), backend)).rowNumber, 7)
})
