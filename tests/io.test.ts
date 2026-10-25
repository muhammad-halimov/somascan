/**
 * Файлы: блокировка записи (в т. ч. брошенная), замки редакторов, бэкапы и откат.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { Backups, EditorLock, FileBusyError, FileLock, LOCK_STALE_MS } from '../src/engine/FileGuard'
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
  const s = path.join(dir, 'S.xlsx')
  const p = path.join(dir, 'P.xlsx')
  fs.writeFileSync(s, 'v1')
  fs.writeFileSync(p, 'p1')
  new Backups(30).save([s, p], '2026-10-19T10-00-00-000Z')
  fs.writeFileSync(s, 'v2')
  assert.deepEqual(Backups.stamps(s), ['2026-10-19T10-00-00-000Z'])
  const r = Backups.restore('2026-10-19T10-00-00-000Z', s, p, [], new Date(2026, 9, 19, 12))
  assert.equal(fs.readFileSync(s, 'utf8'), 'v1')
  assert.match(r.savedAs, /^before-restore-/)
  assert.equal(Backups.stamps(s).length, 2, 'состояние перед откатом тоже сохранено')
  assert.throws(() => Backups.restore('2020-01-01T00-00-00-000Z', s, p, []), /Нет копий для метки/)
})

test('старые бэкапы удаляются', () => {
  const dir = tmp()
  const s = path.join(dir, 'S.xlsx')
  fs.writeFileSync(s, 'x')
  new Backups(30).save([s], '2026-01-01T00-00-00-000Z')
  new Backups(30).save([s], '2026-10-19T00-00-00-000Z', Date.now() + 31 * 864e5)
  assert.deepEqual(Backups.stamps(s), [], 'копии «старше» 30 дней удалены вместе со свежей (её время — сейчас)')
})
