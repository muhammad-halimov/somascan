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
  assert.deepEqual(parseSettings({ advanced: { knownSuppliers: ['Sovel', 42, 'Habas', 'sovel'], knownSuppliersVersion: 3 } }, defaults).advanced.knownSuppliers, ['Habas', 'Sovel'])
  assert.deepEqual(parseSettings({ advanced: { knownSuppliers: [] } }, defaults).advanced.knownSuppliers, [])
})

test('SOMACO, BPM, D&D Drótáru: в списке по умолчанию; сохранённый список прежней версии их получает, удалённые потом — не возвращаются', () => {
  const added = ['SOMACO', 'BPM', 'D&D Drótáru']
  for (const name of added) assert.ok(DEFAULT_KNOWN_SUPPLIERS.includes(name), name)
  const before = DEFAULT_KNOWN_SUPPLIERS.filter((name) => !added.includes(name))
  const migrated = parseSettings({ advanced: { knownSuppliers: before } }, defaults).advanced
  assert.deepEqual([migrated.knownSuppliers, migrated.knownSuppliersVersion], [[...DEFAULT_KNOWN_SUPPLIERS], 3])
  // список версии 2 (SOMACO уже был) получает только канаты
  const fromV2 = parseSettings({ advanced: { knownSuppliers: ['Habas', 'SOMACO'], knownSuppliersVersion: 2 } }, defaults).advanced.knownSuppliers
  assert.deepEqual(fromV2, ['BPM', 'D&D Drótáru', 'Habas', 'SOMACO'])
  assert.deepEqual(parseSettings({ advanced: { knownSuppliers: ['Habas'], knownSuppliersVersion: 3 } }, defaults).advanced.knownSuppliers, ['Habas'])
})

test('зелёные бирки SOMACO: и в промпте по умолчанию, и в пояснениях полей — они идут и со своим промптом', () => {
  const fields = enabledLabelFields(createDefaultLabelFields())
  assert.match(buildLabelPrompt('', fields), /9\. Green tags of SOMACO/)
  const own = buildLabelPrompt('Read the tag.', fields)
  assert.ok(!own.includes('9. Green tags'))
  assert.match(own, /"producer" — .*green SOMACO tags .*"SOMACO"/)
  assert.match(own, /"heat" — .*green SOMACO tags .*in asterisks under the barcode/)
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
