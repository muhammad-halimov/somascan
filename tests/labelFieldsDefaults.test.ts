/**
 * Поля по умолчанию: включены пять основных; нетронутый выбор прежней версии («включено всё»)
 * переводится на них, изменённый пользователем — сохраняется.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDefaultLabelFields, enabledLabelFields, isDefaultLabelFields } from '../src/features/recognition/label/labelFields'
import { providerRegistry } from '../src/features/recognition/providers/ProviderRegistry'
import { createDefaultSettings, LABEL_FIELDS_VERSION, parseSettings, type AppSettings } from '../src/features/settings/store/settingsSchema'

const enabledKeys = (settings: AppSettings) => enabledLabelFields(settings.advanced.labelFields).map((field) => field.key)
const defaults = createDefaultSettings(providerRegistry)

test('по умолчанию — пять основных полей', () => {
  assert.deepEqual(enabledLabelFields(createDefaultLabelFields()).map((field) => field.key), ['producer', 'grade', 'size', 'heat', 'weight_kg'])
  assert.ok(isDefaultLabelFields(createDefaultLabelFields()))
})

test('нетронутый выбор версии 1 переходит на новые значения по умолчанию', () => {
  const allEnabled = createDefaultLabelFields().map((field) => ({ ...field, enabled: true }))
  const migrated = parseSettings({ advanced: { labelFields: allEnabled } }, defaults)
  assert.deepEqual(enabledKeys(migrated), ['producer', 'grade', 'size', 'heat', 'weight_kg'])
  assert.equal(migrated.advanced.labelFieldsVersion, LABEL_FIELDS_VERSION)
})

test('изменённый выбор и выбор новой версии сохраняются', () => {
  const custom = createDefaultLabelFields().map((field) => ({ ...field, enabled: field.key === 'contract' || field.key === 'heat' }))
  assert.deepEqual(enabledKeys(parseSettings({ advanced: { labelFields: custom } }, defaults)), ['heat', 'contract'])
  const allEnabledV2 = createDefaultLabelFields().map((field) => ({ ...field, enabled: true }))
  assert.equal(enabledKeys(parseSettings({ advanced: { labelFields: allEnabledV2, labelFieldsVersion: 2 } }, defaults)).length, allEnabledV2.length)
})
