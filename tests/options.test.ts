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
