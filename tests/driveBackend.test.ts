/**
 * Запись таблицы в Google Drive через поддельный Drive API: дописывание, резервные копии,
 * блокировки, конфликт версий, очистка копий, отсутствующие папка и таблица (её не создаём).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DriveClient, XLSX_MIME } from '../src/features/uploads/drive/DriveClient'
import { DriveTableBackend } from '../src/features/uploads/drive/DriveTableBackend'
import { parseDriveFileName, parseDriveFolder } from '../src/features/uploads/drive/driveSettings'
import type { UploadRecord } from '../src/features/uploads/store/UploadStore'
import { TableWriter } from '../src/features/uploads/worker/TableWriter'
import { BackupPolicy } from '../src/features/uploads/xlsx/BackupPolicy'
import { arrivalDateText } from '../src/features/uploads/xlsx/labTableCells'
import { LabelWorkbook } from '../src/features/uploads/xlsx/LabelWorkbook'
import type { UploadColumn } from '../src/features/uploads/xlsx/uploadColumns'
import { FakeDrive } from './fakeDrive'

const columns: UploadColumn[] = [
  { key: 'heat', kind: 'code', header: 'Плавка', aliases: ['heat'] },
  { key: 'producer', kind: 'text', header: 'Производитель', aliases: ['producer'] },
]

/** Пустой журнал с листом `2026`. */
const template = new Uint8Array(readFileSync(new URL('./fixtures/Probe otel.xlsx', import.meta.url)))

const record = (n: number): UploadRecord => ({
  id: `id-${n}`, createdAt: Date.UTC(2026, 9, 7, 10, n), localNumber: `SCN-261007-000${n}`,
  label: { heat: `H${n}`, producer: 'Sovel', product_form: 'bobina', size: '10 mm', weight_kg: 1000 + n },
  columns, status: 'queued', attempts: 0,
})

/** Писатель и хранилище поверх поддельного Drive; `withTable` — в папке уже лежит пустой журнал. */
function setup(drive: FakeDrive, folder = 'folder1', withTable = true) {
  if (withTable && drive.files.has(folder)) drive.add({ name: 'labels.xlsx', mimeType: XLSX_MIME, parents: [folder], bytes: template })
  const backend = new DriveTableBackend(new DriveClient('token', drive.fetch), folder, 'labels.xlsx', () => drive.now)
  return { backend, writer: new TableWriter('device-a', () => drive.now) }
}

test('нет таблицы — tableNotFound: ничего не создаётся, проверка видит, что таблицы нет', async () => {
  const drive = new FakeDrive()
  drive.add({ id: 'folder1', name: 'Somascan', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] })
  const { backend, writer } = setup(drive, 'folder1', false)
  assert.deepEqual(await backend.probe(), { exists: false, size: 0, modifiedAt: 0 })
  await assert.rejects(writer.write(record(1), backend), (error: Error & { code?: string }) => error.code === 'tableNotFound')
  assert.deepEqual(drive.childrenOf('folder1').map((file) => file.name), [], 'ни таблицы, ни блокировки, ни папки копий')
  await assert.rejects(backend.replace(template, 'labels.copy.xlsx'), (error: Error & { code?: string }) => error.code === 'tableNotFound')
})

test('дописывание в существующую таблицу, резервная копия', async () => {
  const drive = new FakeDrive()
  drive.add({ id: 'folder1', name: 'Somascan', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] })
  const { backend, writer } = setup(drive)
  assert.equal((await backend.probe()).exists, true)
  const year = String(new Date(drive.now).getFullYear())
  assert.deepEqual(await writer.write(record(1), backend), { sheet: year, rowNumber: 7, item: 1, duplicate: false })
  drive.now += 60_000
  assert.deepEqual(await writer.write(record(2), backend), { sheet: year, rowNumber: 8, item: 2, duplicate: false })
  assert.deepEqual(await writer.write(record(2), backend), { sheet: year, rowNumber: 8, item: 2, duplicate: true }, 'повтор не дублирует строку')

  const tables = drive.childrenOf('folder1').filter((file) => file.name === 'labels.xlsx')
  assert.equal(tables.length, 1)
  const workbook = await LabelWorkbook.open(tables[0]!.bytes)
  // Nr. Crt., Cantitatea, Data intrare (день записи в таблицу по часам поддельного Drive), Sarja, Producator, Ø Bobina.
  assert.deepEqual(workbook.readCells({ sheet: year, row: 8 }, [3, 4, 6, 7, 8, 9]), [2, '1002Kg', arrivalDateText(drive.now), 'H2', 'Sovel', 10])
  const backups = drive.childrenOf('folder1').find((file) => file.name === 'backups')!
  assert.equal(drive.childrenOf(backups.id).length, 2, 'копия перед каждой записью (повтор ничего не пишет)')
  assert.equal(drive.childrenOf('folder1').some((file) => file.name.endsWith('.lock')), false, 'блокировка снята')
})

test('чужая свежая блокировка — busy, брошенная — снимается', async () => {
  const drive = new FakeDrive()
  drive.add({ id: 'folder1', name: 'Somascan', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] })
  const { backend, writer } = setup(drive)
  drive.add({ name: 'labels.xlsx.lock', mimeType: 'text/plain', parents: ['folder1'], appProperties: { somascanLockOwner: 'device-b' } })
  await assert.rejects(writer.write(record(1), backend), (error: Error & { code?: string; params?: { owner?: string } }) => error.code === 'busy' && error.params?.owner === 'device-b')
  drive.now += 6 * 60_000
  assert.equal((await writer.write(record(1), backend)).rowNumber, 7)
})

test('своя блокировка от оборванной записи снимается сразу', async () => {
  const drive = new FakeDrive()
  drive.add({ id: 'folder1', name: 'Somascan', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] })
  const { backend, writer } = setup(drive)
  drive.add({ name: 'labels.xlsx.lock', mimeType: 'text/plain', parents: ['folder1'], appProperties: { somascanLockOwner: 'device-a' } })
  assert.equal((await writer.write(record(1), backend)).rowNumber, 7)
  assert.equal(drive.childrenOf('folder1').some((file) => file.name.endsWith('.lock')), false)
})

test('таблицу изменили во время записи — busy, чужие данные не затёрты', async () => {
  const drive = new FakeDrive()
  drive.add({ id: 'folder1', name: 'Somascan', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] })
  const { backend, writer } = setup(drive)
  await writer.write(record(1), backend)
  const table = drive.childrenOf('folder1').find((file) => file.name === 'labels.xlsx')!
  const before = table.bytes
  drive.onDownload = (file) => {
    drive.onDownload = undefined
    file.version++ // кто-то сохранил таблицу в Excel онлайн
  }
  await assert.rejects(writer.write(record(2), backend), (error: Error & { code?: string }) => error.code === 'busy')
  assert.equal(table.bytes, before, 'содержимое не тронуто')
  assert.equal((await writer.write(record(2), backend)).rowNumber, 8, 'повтор проходит')
})

test('старые копии удаляются, свежие и чужие — нет', async () => {
  const drive = new FakeDrive()
  drive.add({ id: 'folder1', name: 'Somascan', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] })
  const backups = drive.add({ name: 'backups', mimeType: 'application/vnd.google-apps.folder', parents: ['folder1'] })
  const policy = new BackupPolicy('labels', '.xlsx')
  const day = 24 * 60 * 60 * 1000
  drive.add({ name: policy.backupName(new Date(drive.now - 8 * day)), mimeType: 'x', parents: [backups.id] })
  drive.add({ name: policy.backupName(new Date(drive.now - 2 * day)), mimeType: 'x', parents: [backups.id] })
  drive.add({ name: 'notes.txt', mimeType: 'text/plain', parents: [backups.id] })
  const { backend, writer } = setup(drive)
  await writer.write(record(1), backend)
  const kept = [policy.backupName(new Date(drive.now - 2 * day)), policy.backupName(new Date(drive.now)), 'notes.txt']
  assert.deepEqual(drive.childrenOf(backups.id).map((file) => file.name).sort(), kept.sort(), 'копия этой записи тоже остаётся')
})

test('нет папки — folderNotFound; разбор настроек', async () => {
  const drive = new FakeDrive()
  const { backend, writer } = setup(drive, 'missing')
  await assert.rejects(writer.write(record(1), backend), (error: Error & { code?: string }) => error.code === 'folderNotFound')
  assert.equal(parseDriveFolder('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp?usp=sharing'), '1AbCdEfGhIjKlMnOp')
  assert.equal(parseDriveFolder(''), 'root')
  assert.equal(parseDriveFileName('labels'), 'labels.xlsx')
  assert.throws(() => parseDriveFileName('a/b.xlsx'))
})

test('отменённая запись останавливается до замены файла: журнал не тронут, блокировка снята', async () => {
  const drive = new FakeDrive()
  drive.add({ id: 'folder1', name: 'Somascan', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] })
  const { backend, writer } = setup(drive)
  await writer.write(record(1), backend)
  const table = drive.childrenOf('folder1').find((file) => file.name === 'labels.xlsx')!
  const before = table.bytes
  const controller = new AbortController()
  drive.onDownload = () => {
    drive.onDownload = undefined
    controller.abort() // отменили, пока журнал читался
  }
  await assert.rejects(writer.write(record(2), backend, controller.signal), (error: Error & { code?: string }) => error.code === 'cancelled')
  assert.equal(table.bytes, before, 'журнал не тронут')
  assert.equal(drive.childrenOf('folder1').some((file) => file.name.endsWith('.lock')), false, 'блокировка снята')
  assert.equal((await writer.write(record(2), backend)).rowNumber, 8, 'без отмены запись проходит')
})
