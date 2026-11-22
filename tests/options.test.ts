/**
 * Параметры движка из командной строки и окружения.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseEngineOptions } from '../src/engine/EngineOptions'

test('синхронизация: файлы, флаги, окружение', () => {
  const o = parseEngineOptions(['--apply', 'C.xlsx', 'S.xlsx', 'P.xlsx'], { RULE: 'oldest', GUARD_OPEN_FILES: '0' }, new Date(2026, 0, 5))
  assert.equal(o.command, 'sync')
  assert.equal(o.apply, true)
  assert.deepEqual([o.consum, o.sarjele, o.probe], ['C.xlsx', 'S.xlsx', 'P.xlsx'])
  assert.equal(o.rule, 'oldest')
  assert.equal(o.guardOpenFiles, false)
  assert.deepEqual(o.probeSheets, ['2026'])
  assert.equal(o.probeSheetsExplicit, false)
})

test('команды: --scan, --create-sheets', () => {
  assert.equal(parseEngineOptions(['--scan', 'C', 'S', 'P'], {}).command, 'scan')
  assert.equal(parseEngineOptions(['--create-sheets', 'C', 'S', 'P'], {}).command, 'create-sheets')
  assert.equal(parseEngineOptions(['C', 'S', 'P'], {}).command, 'sync')
})

test('откат: метка, Sarjele, Probe и Consum', () => {
  const o = parseEngineOptions(['--restore', '2026-10-19T10-00-00-000Z', 'S.xlsx', 'P.xlsx', 'C1.xlsx', 'C2.xlsx'], {})
  assert.equal(o.command, 'restore')
  assert.deepEqual(o.restore, { stamp: '2026-10-19T10-00-00-000Z', consums: ['C1.xlsx', 'C2.xlsx'] })
  assert.equal(o.sarjele, 'S.xlsx')
  const list = parseEngineOptions(['--restore', 'S.xlsx', 'P.xlsx'], {})
  assert.equal(list.restore?.stamp, null, 'без метки — список копий')
})

test('испорченный JSON в окружении — значения по умолчанию', () => {
  const o = parseEngineOptions(['C', 'S', 'P'], { PROJECTS_CFG: '{', ACTIVE_SOURCES: '[' })
  assert.deepEqual(o.projects, [])
  assert.deepEqual([...o.activeSources!], [])
})

test('таблица лаборатории: миграция и откат с --laborator / --calitate', () => {
  const m = parseEngineOptions(['--laborator', '--migrate', '--apply', 'L.xlsx'], {})
  assert.equal(m.command, 'lab-migrate')
  assert.equal(m.apply, true)
  assert.equal(m.migrateOnly, true)
  assert.deepEqual(m.desk, { kind: 'laborator', file: 'L.xlsx' })
  const r = parseEngineOptions(['--restore', '2026-11-15T10-00-00-000Z', '--calitate', 'Q.xlsx'], {})
  assert.equal(r.command, 'restore')
  assert.deepEqual(r.restore, { stamp: '2026-11-15T10-00-00-000Z', consums: [] })
  assert.deepEqual(r.desk, { kind: 'calitate', file: 'Q.xlsx' })
  assert.equal(parseEngineOptions(['C', 'S', 'P'], {}).desk, null)
})

test('чтение таблицы лаборатории: --laborator --read, подпись — из SIGNATURE', () => {
  const o = parseEngineOptions(['--laborator', '--read', 'L.xlsx'], { SIGNATURE: '/data/signatures/laborator-1.png' })
  assert.equal(o.command, 'lab-read')
  assert.equal(o.apply, false)
  assert.deepEqual(o.desk, { kind: 'laborator', file: 'L.xlsx' })
  assert.equal(o.signature, '/data/signatures/laborator-1.png')
  assert.equal(parseEngineOptions(['--laborator', '--read', 'L.xlsx'], {}).signature, '')
})
