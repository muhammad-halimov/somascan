/**
 * Разбор сохранённых настроек: значения по умолчанию, испорченные поля, слияние изменений.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeFiles, DEFAULT_SETTINGS, mergeSettings, parseSettings } from '../src/shared/settings'

test('пустой или испорченный файл — значения по умолчанию', () => {
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(parseSettings('мусор'), DEFAULT_SETTINGS)
})

test('испорченное поле не сбрасывает остальные', () => {
  const s = parseSettings({ write: true, theme: 'purple', intervalSec: 'много', files: { local: { sarjele: '/a.xlsx', consums: [] } } })
  assert.equal(s.write, true)
  assert.equal(s.theme, 'system')
  assert.equal(s.intervalSec, DEFAULT_SETTINGS.intervalSec)
  assert.equal(s.files.local.sarjele, '/a.xlsx')
  assert.deepEqual(s.files.local.consums, [''], 'хотя бы одно поле Consum')
  assert.deepEqual(s.files.smb, { consums: [''], sarjele: '', probe: '' })
  assert.equal(s.guardOpenFiles, true, 'новая настройка — включена по умолчанию')
})

test('проекты без имени отбрасываются, недостающие поля дополняются', () => {
  const s = parseSettings({ projects: [{ name: 'A', sheet: 'S' }, { sheet: 'без имени' }, 5] })
  assert.deepEqual(s.projects, [{ name: 'A', aliases: [], sheet: 'S', prefix: '', create: true, enabled: true, locked: true }])
})

test('границы интервалов: от 2 до 10 с', () => {
  const s = parseSettings({ intervalSec: 0, settleSec: -3, backupDays: 0 })
  assert.equal(s.intervalSec, 2)
  assert.equal(s.settleSec, 0)
  assert.equal(s.backupDays, 1)
  assert.equal(parseSettings({ intervalSec: 300, settleSec: 30 }).intervalSec, 10)
  assert.equal(parseSettings({ settleSec: 30 }).settleSec, 10)
})

test('у этого компьютера и сетевого диска свои файлы', () => {
  const s = mergeSettings(DEFAULT_SETTINGS, { files: { smb: { consums: ['//srv/c.xlsx'], sarjele: '//srv/s.xlsx', probe: '' } } })
  assert.equal(s.files.smb.sarjele, '//srv/s.xlsx')
  assert.equal(s.files.local.sarjele, '', 'набор другого места не тронут')
  assert.deepEqual(activeFiles({ ...s, target: 'smb' }).consums, ['//srv/c.xlsx'])
  assert.deepEqual(activeFiles(s).consums, [''])
})

test('прежний общий набор файлов переходит к месту хранения, выбранному тогда', () => {
  const old = { target: 'smb', consums: ['/c.xlsx'], paths: { sarjele: '/s.xlsx', probe: '/p.xlsx' } }
  const s = parseSettings(old)
  assert.deepEqual(s.files.smb, { consums: ['/c.xlsx'], sarjele: '/s.xlsx', probe: '/p.xlsx' })
  assert.equal(s.files.local.sarjele, '')
})

test('телефоны и «звонок» Firestore: по умолчанию выключены; сохранённые разбираются, испорченные — по умолчанию', () => {
  assert.equal(DEFAULT_SETTINGS.bridge, false)
  assert.deepEqual(DEFAULT_SETTINGS.firestore, { enabled: false, projectId: '', apiKey: '' })
  const s = parseSettings({ bridge: true, firestore: { enabled: true, projectId: ' somascan-test ', apiKey: 'AIzaKey', extra: 1 } })
  assert.equal(s.bridge, true)
  assert.deepEqual(s.firestore, { enabled: true, projectId: 'somascan-test', apiKey: 'AIzaKey' })
  assert.deepEqual(parseSettings({ firestore: 'мусор' }).firestore, DEFAULT_SETTINGS.firestore)
})
