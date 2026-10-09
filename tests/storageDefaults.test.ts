/**
 * Таблица по умолчанию — журнал проб «Probe otel.xlsx»: в новых настройках и вместо пустого пути
 * или имени из прежних версий; указанные пользователем путь и имя сохраняются.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { providerRegistry } from '../src/features/recognition/providers/ProviderRegistry'
import { createDefaultSettings, DEFAULT_TABLE_FILE, parseSettings } from '../src/features/settings/store/settingsSchema'

const defaults = createDefaultSettings(providerRegistry)

test('по умолчанию — Probe otel.xlsx на сетевом диске и в Google Drive', () => {
  assert.equal(DEFAULT_TABLE_FILE, 'Probe otel.xlsx')
  assert.equal(defaults.storage.smb.filePath, DEFAULT_TABLE_FILE)
  assert.equal(defaults.storage.googleDrive.fileName, DEFAULT_TABLE_FILE)
})

test('пустой путь и имя прежних версий заменяются таблицей по умолчанию, свои — остаются', () => {
  const empty = parseSettings({ storage: { smb: { host: 'srv', filePath: '  ' }, googleDrive: { fileName: '' } } }, defaults)
  assert.equal(empty.storage.smb.filePath, DEFAULT_TABLE_FILE)
  assert.equal(empty.storage.smb.host, 'srv')
  assert.equal(empty.storage.googleDrive.fileName, DEFAULT_TABLE_FILE)
  const own = parseSettings({ storage: { smb: { filePath: 'Probe si Sarje Otel\\Probe otel.xlsx' }, googleDrive: { fileName: 'labels.xlsx' } } }, defaults)
  assert.equal(own.storage.smb.filePath, 'Probe si Sarje Otel\\Probe otel.xlsx')
  assert.equal(own.storage.googleDrive.fileName, 'labels.xlsx')
})

test('лист журнала: по умолчанию пусто (лист текущего года), выбранный сохраняется', () => {
  assert.equal(defaults.storage.sheet, '')
  assert.equal(parseSettings({ storage: { sheet: ' 2025 ' } }, defaults).storage.sheet, '2025')
  assert.equal(parseSettings({ storage: { sheet: 7 } }, defaults).storage.sheet, '')
})
