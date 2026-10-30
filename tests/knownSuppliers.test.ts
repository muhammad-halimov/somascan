/**
 * Известные поставщики: список по умолчанию чистый и по алфавиту, чтение настроек не теряет
 * правок пользователя, правило в промпте появляется только при непустом списке, экспорт и импорт в JSON.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_KNOWN_SUPPLIERS, isDefaultSuppliers, normalizeSuppliers, parseSuppliersJson, suppliersToJson } from '../src/features/recognition/label/knownSuppliers'
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
  assert.deepEqual(parseSettings({ advanced: { knownSuppliers: ['Sovel', 42, 'Habas', 'sovel'], knownSuppliersVersion: 2 } }, defaults).advanced.knownSuppliers, ['Habas', 'Sovel'])
  assert.deepEqual(parseSettings({ advanced: { knownSuppliers: [] } }, defaults).advanced.knownSuppliers, [])
})

test('SOMACO: в списке по умолчанию; сохранённый список прежней версии его получает, удалённый потом — не возвращается', () => {
  assert.ok(DEFAULT_KNOWN_SUPPLIERS.includes('SOMACO'))
  const before = DEFAULT_KNOWN_SUPPLIERS.filter((name) => name !== 'SOMACO')
  const migrated = parseSettings({ advanced: { knownSuppliers: before } }, defaults).advanced
  assert.deepEqual([migrated.knownSuppliers, migrated.knownSuppliersVersion], [[...DEFAULT_KNOWN_SUPPLIERS], 2])
  assert.deepEqual(parseSettings({ advanced: { knownSuppliers: ['Habas'], knownSuppliersVersion: 2 } }, defaults).advanced.knownSuppliers, ['Habas'])
})

test('правило о поставщиках — только при непустом списке, перед оценкой фото', () => {
  const fields = enabledLabelFields(createDefaultLabelFields())
  assert.ok(!buildLabelPrompt('', fields).includes('Known suppliers'))
  const prompt = buildLabelPrompt('', fields, ['ArcelorMittal', 'Sovel'])
  assert.ok(prompt.includes('Known suppliers'))
  assert.ok(prompt.includes('- ArcelorMittal\n- Sovel'))
  assert.ok(prompt.indexOf('Known suppliers') < prompt.indexOf('"_photo"'))
})

test('экспорт в JSON читается импортом без потерь', () => {
  const json = suppliersToJson(DEFAULT_KNOWN_SUPPLIERS)
  assert.deepEqual(JSON.parse(json), { suppliers: [...DEFAULT_KNOWN_SUPPLIERS] })
  assert.deepEqual(parseSuppliersJson(json), [...DEFAULT_KNOWN_SUPPLIERS])
})

test('импорт: массив названий или объект с «suppliers», с BOM; названия чистятся, не строки пропускаются', () => {
  assert.deepEqual(parseSuppliersJson('["  Sovel ", "Habas", "SOVEL", 42, null]'), ['Habas', 'Sovel'])
  assert.deepEqual(parseSuppliersJson('\uFEFF{"suppliers": ["Suez   Steel Co"], "version": 1}'), ['Suez Steel Co'])
})

test('импорт: не JSON, без названий или без списка — null', () => {
  assert.equal(parseSuppliersJson('Sovel, Habas'), null)
  assert.equal(parseSuppliersJson('[]'), null)
  assert.equal(parseSuppliersJson('["", "   ", 7]'), null)
  assert.equal(parseSuppliersJson('{"names": ["Sovel"]}'), null)
  assert.equal(parseSuppliersJson('null'), null)
  assert.equal(parseSuppliersJson('"Sovel"'), null)
})
