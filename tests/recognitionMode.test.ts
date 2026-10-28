/**
 * Распознавание телефоном или ИИ-моделью: по умолчанию — телефон; ИИ-провайдер запоминается,
 * а у настроек прежней версии им становится провайдер, которым распознавали до сих пор.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { providerRegistry } from '../src/features/recognition/providers/ProviderRegistry'
import { createDefaultSettings, parseSettings } from '../src/features/settings/store/settingsSchema'

const defaults = createDefaultSettings(providerRegistry)

test('по умолчанию распознаёт телефон, ИИ-провайдер — Google', () => {
  assert.equal(defaults.general.provider, 'device')
  assert.equal(defaults.general.modelProvider, 'google')
  assert.equal(parseSettings(undefined, defaults).general.provider, 'device')
})

test('настройки прежней версии: провайдер остаётся и запоминается как ИИ-провайдер', () => {
  const { general } = parseSettings({ general: { provider: 'lmstudio' } }, defaults)
  assert.equal(general.provider, 'lmstudio')
  assert.equal(general.modelProvider, 'lmstudio')
})

test('сохранённый ИИ-провайдер читается, телефон им быть не может', () => {
  assert.equal(parseSettings({ general: { provider: 'device', modelProvider: 'openai' } }, defaults).general.modelProvider, 'openai')
  assert.equal(parseSettings({ general: { provider: 'device', modelProvider: 'device' } }, defaults).general.modelProvider, 'google')
})

test('у распознавания на устройстве нет ключа, модели и сервера', async () => {
  const device = providerRegistry.get('device')
  assert.equal(device.onDevice, true)
  assert.equal(device.isConfigured({ apiKey: '' }), true)
  assert.equal(device.defaultEndpoint, '')
  assert.deepEqual(await device.listCandidates({ apiKey: '', endpoint: '' }), [])
  assert.deepEqual(providerRegistry.all().filter((provider) => provider.onDevice).map((provider) => provider.id), ['device'])
})
