/**
 * Таблицы из главного процесса — асинхронно (`host/files`): время и размер, наличие, замок редактора, бэкапы,
 * ответ за отведённое время.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { backupStamps, exists, fileStamp, openInEditor, withTimeout } from '../src/host/files'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somasync-files-'))
const table = path.join(dir, 'Probe otel.xlsx')
fs.writeFileSync(table, 'xlsx')

test('время и размер файла; нет файла — null', async () => {
  const st = fs.statSync(table)
  assert.equal(await fileStamp(table), `${st.mtimeMs}:${st.size}`)
  assert.equal(await fileStamp(path.join(dir, 'нет.xlsx')), null)
  assert.equal(await exists(table), true)
  assert.equal(await exists(path.join(dir, 'нет.xlsx')), false)
})

test('замок редактора рядом с таблицей: Excel и LibreOffice', async () => {
  assert.equal(await openInEditor(table), false)
  fs.writeFileSync(path.join(dir, '~$Probe otel.xlsx'), '')
  assert.equal(await openInEditor(table), true)
  fs.rmSync(path.join(dir, '~$Probe otel.xlsx'))
  fs.writeFileSync(path.join(dir, '.~lock.Probe otel.xlsx#'), '')
  assert.equal(await openInEditor(table), true)
  fs.rmSync(path.join(dir, '.~lock.Probe otel.xlsx#'))
})

test('метки бэкапов: новые сверху; нет папки — пусто', async () => {
  assert.deepEqual(await backupStamps(table, 5), [])
  fs.mkdirSync(path.join(dir, 'backups'))
  for (const name of ['2026-10-01T08-00-00-000Z_Probe otel.xlsx', '2026-10-02T08-00-00-000Z_Probe otel.xlsx', 'чужой.txt']) fs.writeFileSync(path.join(dir, 'backups', name), '')
  assert.deepEqual(await backupStamps(table, 5), ['2026-10-02T08-00-00-000Z', '2026-10-01T08-00-00-000Z'])
})

test('ответ за отведённое время, иначе — запасной (диск не отвечает)', async () => {
  assert.equal(await withTimeout(Promise.resolve('готово'), 50, () => 'нет ответа'), 'готово')
  assert.equal(await withTimeout(new Promise<string>(() => {}), 20, () => 'нет ответа'), 'нет ответа')
})
