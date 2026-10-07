/**
 * Известные поставщики: список по умолчанию чистый и по алфавиту, чтение настроек не теряет
 * правок пользователя, правило в промпте появляется только при непустом списке.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_KNOWN_SUPPLIERS, isDefaultSuppliers, normalizeSuppliers } from '../src/features/recognition/label/knownSuppliers'
import { createDefaultLabelFields, enabledLabelFields } from '../src/features/recognition/label/labelFields'
import { buildLabelPrompt } from '../src/features/recognition/label/labelPrompt'
import { providerRegistry } from '../src/features/recognition/providers/ProviderRegistry'
import { createDefaultSettings, parseSettings } from '../src/features/settings/store/settingsSchema'

const defaults = createDefaultSettings(providerRegistry)

test('список по умолчанию уже нормализован', () => {
  assert.deepEqual(normalizeSuppliers(DEFAULT_KNOWN_SUPPLIERS), [...DEFAULT_KNOWN_SUPPLIERS])
  assert.ok(isDefaultSuppliers(defaults.advanced.knownSuppliers))
})

test('нормализация убирает пустые, повторы без учёта регистра и лишние пробелы', () => {
  assert.deepEqual(normalizeSuppliers(['  sovel ', 'Habas', 'SOVEL', '', 'Promet   Steel']), ['Habas', 'Promet Steel', 'sovel'])
})

test('чтение настроек: нет списка — по умолчанию, свой список и пустой сохраняются', () => {
  assert.deepEqual(parseSettings({ advanced: {} }, defaults).advanced.knownSuppliers, [...DEFAULT_KNOWN_SUPPLIERS])
  assert.deepEqual(parseSettings({ advanced: { knownSuppliers: ['Sovel', 42, 'Habas', 'sovel'] } }, defaults).advanced.knownSuppliers, ['Habas', 'Sovel'])
  assert.deepEqual(parseSettings({ advanced: { knownSuppliers: [] } }, defaults).advanced.knownSuppliers, [])
})

test('правило о поставщиках — только при непустом списке, перед оценкой фото', () => {
  const fields = enabledLabelFields(createDefaultLabelFields())
  assert.ok(!buildLabelPrompt('', fields).includes('Known suppliers'))
  const prompt = buildLabelPrompt('', fields, ['ArcelorMittal', 'Sovel'])
  assert.ok(prompt.includes('Known suppliers'))
  assert.ok(prompt.includes('- ArcelorMittal\n- Sovel'))
  assert.ok(prompt.indexOf('Known suppliers') < prompt.indexOf('"_photo"'))
})
