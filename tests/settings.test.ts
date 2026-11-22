/**
 * Разбор сохранённых настроек: значения по умолчанию, испорченные поля, слияние изменений.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeFiles, DEFAULT_SETTINGS, deskFile, mergeSettings, parseSettings, uncPath } from '../src/shared/settings'

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

test('телефоны включены по умолчанию, «звонок» Firestore выключен; сохранённые разбираются, испорченные — по умолчанию', () => {
  assert.equal(DEFAULT_SETTINGS.bridge, true)
  assert.equal(parseSettings({ bridge: false }).bridge, false, 'сохранённое выключение остаётся')
  assert.deepEqual(DEFAULT_SETTINGS.firestore, { enabled: false, projectId: '', apiKey: '' })
  const s = parseSettings({ bridge: true, firestore: { enabled: true, projectId: ' somascan-test ', apiKey: 'AIzaKey', extra: 1 } })
  assert.equal(s.bridge, true)
  assert.deepEqual(s.firestore, { enabled: true, projectId: 'somascan-test', apiKey: 'AIzaKey' })
  assert.deepEqual(parseSettings({ firestore: 'мусор' }).firestore, DEFAULT_SETTINGS.firestore)
})

test('сетевой диск: «Без авторизации» по умолчанию выключено; сохранённое разбирается, испорченное — по умолчанию', () => {
  assert.equal(DEFAULT_SETTINGS.smb.anonymous, false)
  assert.equal(parseSettings({ smb: { host: 'srv', share: 'Atelier', anonymous: true } }).smb.anonymous, true)
  assert.equal(parseSettings({ smb: { anonymous: 'да' } }).smb.anonymous, false)
  assert.equal(mergeSettings(DEFAULT_SETTINGS, { smb: { anonymous: true } }).smb.anonymous, true)
})

test('сетевой путь общей папки в Windows: \\\\сервер\\папка, без папки — сервер', () => {
  assert.equal(uncPath({ host: '10.0.0.5', share: 'Atelier' }), '\\\\10.0.0.5\\Atelier')
  assert.equal(uncPath({ host: '10.0.0.5', share: '' }), '\\\\10.0.0.5')
})

test('подписи рабочих мест: по умолчанию нет; сохранённые разбираются, испорченные — пусто', () => {
  assert.deepEqual(DEFAULT_SETTINGS.signatures, { atelier: '', laborator: '', calitate: '' })
  const s = parseSettings({ signatures: { atelier: '/data/signatures/atelier-1.png', calitate: 5 } })
  assert.deepEqual(s.signatures, { atelier: '/data/signatures/atelier-1.png', laborator: '', calitate: '' })
  // подпись лаборатории сначала хранилась в её настройках
  assert.equal(parseSettings({ desks: { laborator: { signature: '/data/signatures/laborator-1.png' } } }).signatures.laborator, '/data/signatures/laborator-1.png')
  assert.equal(parseSettings({ signatures: { laborator: '/new.png' }, desks: { laborator: { signature: '/old.png' } } }).signatures.laborator, '/new.png')
  assert.deepEqual(mergeSettings(s, { signatures: { laborator: '/l.png' } }).signatures, { atelier: '/data/signatures/atelier-1.png', laborator: '/l.png', calitate: '' })
})

test('замок на копии Probe для телефонов: по умолчанию открыт, сохранённый разбирается', () => {
  assert.equal(DEFAULT_SETTINGS.locked.copy, false)
  assert.equal(parseSettings({ locked: { copy: true } }).locked.copy, true)
  assert.equal(parseSettings({ locked: { folder: true } }).locked.copy, false)
})

test('рабочее место: по умолчанию цех; сохранённое разбирается, испорченное — по умолчанию', () => {
  assert.equal(DEFAULT_SETTINGS.workplace, 'atelier')
  assert.equal(parseSettings({ workplace: 'laborator' }).workplace, 'laborator')
  assert.equal(parseSettings({ workplace: 'calitate' }).workplace, 'calitate')
  assert.equal(parseSettings({ workplace: 'склад' }).workplace, 'atelier')
})

test('лаборатория и контроль качества: своё место хранения без Google Drive и своя таблица у каждого места', () => {
  const empty = { target: 'local', files: { local: '', smb: '' } }
  assert.deepEqual(DEFAULT_SETTINGS.desks, { laborator: empty, calitate: empty })
  const lab = '\\\\srv\\Lab\\Laborator.xlsx'
  const s = parseSettings({ target: 'googleDrive', desks: { laborator: { target: 'smb', files: { smb: lab, local: 5 } }, calitate: { files: { local: '/q/Calitate.xlsx' } } } })
  assert.equal(s.target, 'googleDrive', 'место хранения цеха не тронуто')
  assert.equal(s.desks.laborator.target, 'smb')
  assert.equal(deskFile(s, 'laborator'), lab)
  assert.equal(s.desks.laborator.files.local, '', 'испорченный путь — пусто')
  assert.equal(deskFile(s, 'calitate'), '/q/Calitate.xlsx')
  assert.equal(parseSettings({ desks: { laborator: { target: 'googleDrive' } } }).desks.laborator.target, 'local', 'Google Drive у лаборатории нет')
  const merged = mergeSettings(s, { desks: { laborator: { ...s.desks.laborator, target: 'local' } } })
  assert.equal(merged.desks.laborator.files.smb, lab, 'смена места не стирает таблицы')
  assert.equal(merged.desks.calitate.files.local, '/q/Calitate.xlsx', 'другое рабочее место не тронуто')
  assert.deepEqual(parseSettings({ laborator: { target: 'smb', files: { smb: lab } } }).desks.laborator.files.smb, lab, 'поле первой версии')
  assert.equal(parseSettings({ locked: { laborator: true, calitate: true } }).locked.calitate, true)
})
