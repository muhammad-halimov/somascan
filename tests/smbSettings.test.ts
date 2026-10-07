/**
 * Проверки разбора настроек сетевого диска.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeSharePath, parseSmbHost, tablePaths } from '../src/features/uploads/smb/smbSettings'

test('адрес сервера с портом и без', () => {
  assert.deepEqual(parseSmbHost('fileserver'), { host: 'fileserver', port: 445 })
  assert.deepEqual(parseSmbHost(' 10.0.0.5:1445 '), { host: '10.0.0.5', port: 1445 })
  assert.deepEqual(parseSmbHost('smb://nas/Warehouse'), { host: 'nas', port: 445 })
  assert.deepEqual(parseSmbHost('\\\\nas\\share'), { host: 'nas', port: 445 })
  assert.deepEqual(parseSmbHost('[fe80::1]:446'), { host: 'fe80::1', port: 446 })
  assert.equal(parseSmbHost(''), null)
  assert.equal(parseSmbHost('nas:99999'), null)
})

test('пути внутри общей папки', () => {
  assert.equal(normalizeSharePath('\\Somascan\\labels.xlsx'), 'Somascan/labels.xlsx')
  assert.equal(normalizeSharePath(' a / ./ b.xlsx '), 'a/b.xlsx')
  assert.throws(() => normalizeSharePath('../x.xlsx'), (error: Error & { code?: string }) => error.code === 'invalidPath')
  const paths = tablePaths('Somascan\\labels.xlsx')
  assert.deepEqual(paths, {
    target: 'Somascan/labels.xlsx', dir: 'Somascan', name: 'labels.xlsx', stem: 'labels',
    tmp: 'Somascan/labels.xlsx.tmp', lock: 'Somascan/labels.xlsx.lock', backupDir: 'Somascan/backups',
  })
  assert.equal(tablePaths('labels.XLSX').dir, '')
  assert.throws(() => tablePaths('Somascan'), (error: Error & { code?: string }) => error.code === 'invalidPath')
})
