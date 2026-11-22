/**
 * Файлы: блокировка записи (в т. ч. брошенная), замки редакторов, бэкапы и откат.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { Backups, EditorLock, FileBusyError, FileLock, LOCK_STALE_MS, type BackupFile } from '../src/engine/FileGuard'
import { formatRu } from '../src/shared/messages'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'somasync-io-'))

test('блокировка: вторая занята, после снятия — свободна', () => {
  const file = path.join(tmp(), 'Sarjele.xlsx')
  const a = new FileLock(file)
  a.acquire()
  assert.throws(() => new FileLock(file).acquire(), FileBusyError)
  a.release()
  const b = new FileLock(file)
  b.acquire()
  b.release()
  assert.ok(!fs.existsSync(`${file}.lock`))
})

test('брошенная блокировка: процесс завершился или прошло больше 10 минут', () => {
  const file = path.join(tmp(), 'Probe.xlsx')
  // процесса с таким номером нет
  fs.mkdirSync(`${file}.lock`)
  fs.writeFileSync(path.join(`${file}.lock`, 'owner.json'), JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname(), at: Date.now() }))
  const lock = new FileLock(file)
  lock.acquire()
  assert.match(formatRu(lock.notes[0]!), /снята брошенная блокировка Probe\.xlsx\.lock \(прогон, который её взял, завершился\)/)
  lock.release()
  // папка прежней версии без owner.json, старше срока
  fs.mkdirSync(`${file}.lock`)
  const later = new FileLock(file, () => Date.now() + LOCK_STALE_MS + 60_000)
  later.acquire()
  assert.match(formatRu(later.notes[0]!), /старше 10 мин/)
  later.release()
})

test('живая блокировка этого же процесса не снимается', () => {
  const file = path.join(tmp(), 'C.xlsx')
  const a = new FileLock(file)
  a.acquire()
  assert.throws(() => new FileLock(file).acquire(), /сейчас записывает другой прогон/)
  a.release()
})

test('замки редакторов: `.~lock.…#` и `~$…`', () => {
  const dir = tmp()
  const file = path.join(dir, 'Sarjele.xlsx')
  assert.equal(EditorLock.find(file), null)
  fs.writeFileSync(path.join(dir, '.~lock.Sarjele.xlsx#'), '')
  assert.equal(EditorLock.find(file)?.lockFile, path.join(dir, '.~lock.Sarjele.xlsx#'))
  fs.writeFileSync(path.join(dir, '~$Probe.xlsx'), '')
  assert.deepEqual(EditorLock.openFiles([file, path.join(dir, 'Probe.xlsx'), path.join(dir, 'C.xlsx')]).map((x) => path.basename(x.lock.lockFile)), ['.~lock.Sarjele.xlsx#', '~$Probe.xlsx'])
})

test('бэкапы под одной меткой, список и откат', () => {
  const dir = tmp()
  const s: BackupFile = { file: path.join(dir, 'S.xlsx'), kind: 'sarjele' }
  const p: BackupFile = { file: path.join(dir, 'P.xlsx'), kind: 'probe' }
  fs.writeFileSync(s.file, 'v1')
  fs.writeFileSync(p.file, 'p1')
  new Backups(30).save([s, p], '2026-10-19T10-00-00-000Z')
  fs.writeFileSync(s.file, 'v2')
  assert.deepEqual(Backups.stamps(s), ['2026-10-19T10-00-00-000Z'])
  const r = Backups.restore('2026-10-19T10-00-00-000Z', [s, p], [], new Date(2026, 9, 19, 12))
  assert.equal(fs.readFileSync(s.file, 'utf8'), 'v1')
  assert.match(r.savedAs, /^before-restore-/)
  assert.equal(Backups.stamps(s).length, 2, 'состояние перед откатом тоже сохранено')
  assert.throws(() => Backups.restore('2020-01-01T00-00-00-000Z', [s, p]), /Нет копий для метки/)
})

test('бэкапы по рабочим местам: backup/Atelier/<таблица>, backup/Laborator, backup/Calitate', () => {
  const dir = tmp()
  const tables: BackupFile[] = [
    { file: path.join(dir, 'Consum otel.xlsx'), kind: 'consum' },
    { file: path.join(dir, 'Probe otel.xlsx'), kind: 'probe' },
    { file: path.join(dir, 'Sarjele din elemente.xlsx'), kind: 'sarjele' },
    { file: path.join(dir, 'Laborator.xlsx'), kind: 'laborator' },
    { file: path.join(dir, 'Calitate.xlsx'), kind: 'calitate' },
  ]
  for (const t of tables) fs.writeFileSync(t.file, t.kind)
  new Backups(30).save(tables, '2026-11-15T10-00-00-000Z')
  const list = (...parts: string[]) => fs.readdirSync(path.join(dir, 'backup', ...parts))
  assert.deepEqual(list().sort(), ['Atelier', 'Calitate', 'Laborator'])
  assert.deepEqual(list('Atelier').sort(), ['Consum', 'Probe', 'Sarjele'])
  assert.deepEqual(list('Atelier', 'Consum'), ['2026-11-15T10-00-00-000Z_Consum otel.xlsx'])
  assert.deepEqual(list('Laborator'), ['2026-11-15T10-00-00-000Z_Laborator.xlsx'])
  assert.deepEqual(list('Calitate'), ['2026-11-15T10-00-00-000Z_Calitate.xlsx'])
})

test('копии прежних версий (общая папка backups) видны в списке и годятся для отката', () => {
  const dir = tmp()
  const s: BackupFile = { file: path.join(dir, 'S.xlsx'), kind: 'sarjele' }
  const p: BackupFile = { file: path.join(dir, 'P.xlsx'), kind: 'probe' }
  fs.writeFileSync(s.file, 'v2')
  fs.writeFileSync(p.file, 'p2')
  fs.mkdirSync(path.join(dir, 'backups'))
  for (const [name, text] of [['2026-10-01T08-00-00-000Z_S.xlsx', 'v1'], ['2026-10-01T08-00-00-000Z_P.xlsx', 'p1'], ['2026-09-01T08-00-00-000Z_Другой.xlsx', 'x']]) fs.writeFileSync(path.join(dir, 'backups', name!), text!)
  assert.deepEqual(Backups.stamps(s), ['2026-10-01T08-00-00-000Z'], 'только копии этой таблицы')
  Backups.restore('2026-10-01T08-00-00-000Z', [s, p])
  assert.equal(fs.readFileSync(s.file, 'utf8'), 'v1')
  assert.equal(fs.readFileSync(p.file, 'utf8'), 'p1')
  assert.equal(fs.readdirSync(path.join(dir, 'backup', 'Atelier', 'Sarjele')).length, 1, 'состояние перед откатом — уже в новой папке')
})

test('старые бэкапы удаляются', () => {
  const dir = tmp()
  const s: BackupFile = { file: path.join(dir, 'S.xlsx'), kind: 'sarjele' }
  fs.writeFileSync(s.file, 'x')
  new Backups(30).save([s], '2026-01-01T00-00-00-000Z')
  new Backups(30).save([s], '2026-10-19T00-00-00-000Z', Date.now() + 31 * 864e5)
  assert.deepEqual(Backups.stamps(s), [], 'копии «старше» 30 дней удалены вместе со свежей (её время — сейчас)')
})
