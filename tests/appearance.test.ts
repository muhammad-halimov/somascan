/**
 * «Расширенные» → «Оформление»: стиль (Liquid Glass или Material Design; не выбран — как у устройства) и место
 * кнопок масштаба и поворота фото — значения по умолчанию и разбор сохранённых.
 * Запуск: `npm test`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { providerRegistry } from '../src/features/recognition/providers/ProviderRegistry'
import { createDefaultSettings, parseSettings } from '../src/features/settings/store/settingsSchema'

const defaults = createDefaultSettings(providerRegistry)

test('по умолчанию: оформление как у устройства, кнопки фото — в панели листания', () => {
  assert.equal(defaults.advanced.design, null)
  assert.equal(defaults.advanced.photoTools, 'bar')
})

test('сохранённые разбираются, испорченные — по умолчанию', () => {
  const saved = parseSettings({ advanced: { design: 'glass', photoTools: 'overlay' } }, defaults)
  assert.equal(saved.advanced.design, 'glass')
  assert.equal(saved.advanced.photoTools, 'overlay')
  assert.equal(parseSettings({ advanced: { design: 'material' } }, defaults).advanced.design, 'material')
  const broken = parseSettings({ advanced: { design: 'neon', photoTools: 'top' } }, defaults)
  assert.equal(broken.advanced.design, null)
  assert.equal(broken.advanced.photoTools, 'bar')
})
