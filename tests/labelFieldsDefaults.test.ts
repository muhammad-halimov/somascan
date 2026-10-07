/**
 * Поля по умолчанию: включены четыре основных (производитель, размер, плавка, вес); марка стали
 * и документ качества — необязательные. Нетронутый выбор прежних версий переводится на текущий
 * набор, изменённый пользователем — сохраняется.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDefaultLabelFields, enabledLabelFields, isDefaultLabelFields } from '../src/features/recognition/label/labelFields'
import { providerRegistry } from '../src/features/recognition/providers/ProviderRegistry'
import { createDefaultSettings, LABEL_FIELDS_VERSION, parseSettings, type AppSettings } from '../src/features/settings/store/settingsSchema'

const enabledKeys = (settings: AppSettings) => enabledLabelFields(settings.advanced.labelFields).map((field) => field.key)
const defaults = createDefaultSettings(providerRegistry)
const MAIN = ['producer', 'size', 'heat', 'weight_kg']
/** Сохранённый список прежней версии: без поля «Док. качества», с заданными включёнными полями. */
const saved = (enabled: (key: string) => boolean) =>
  createDefaultLabelFields().filter((field) => field.key !== 'quality_doc').map((field) => ({ ...field, enabled: enabled(field.key) }))

test('по умолчанию — четыре основных поля; марка стали и документ качества выключены', () => {
  const fields = createDefaultLabelFields()
  assert.deepEqual(enabledLabelFields(fields).map((field) => field.key), MAIN)
  assert.ok(fields.some((field) => field.key === 'grade' && !field.enabled))
  assert.ok(fields.some((field) => field.key === 'quality_doc' && !field.enabled))
  assert.ok(isDefaultLabelFields(fields))
})

test('нетронутый выбор версий 1 и 2 переходит на новые значения по умолчанию', () => {
  const v1 = parseSettings({ advanced: { labelFields: saved(() => true) } }, defaults)
  assert.deepEqual(enabledKeys(v1), MAIN)
  assert.equal(v1.advanced.labelFieldsVersion, LABEL_FIELDS_VERSION)
  const v2 = parseSettings({ advanced: { labelFields: saved((key) => [...MAIN, 'grade'].includes(key)), labelFieldsVersion: 2 } }, defaults)
  assert.deepEqual(enabledKeys(v2), MAIN)
  assert.ok(isDefaultLabelFields(v2.advanced.labelFields), 'новое поле встало на своё место')
})

test('изменённый выбор и выбор текущей версии сохраняются', () => {
  const custom = saved((key) => key === 'contract' || key === 'heat')
  assert.deepEqual(enabledKeys(parseSettings({ advanced: { labelFields: custom, labelFieldsVersion: 2 } }, defaults)), ['heat', 'contract'])
  const withGrade = createDefaultLabelFields().map((field) => ({ ...field, enabled: [...MAIN, 'grade', 'quality_doc'].includes(field.key) }))
  assert.deepEqual(enabledKeys(parseSettings({ advanced: { labelFields: withGrade, labelFieldsVersion: LABEL_FIELDS_VERSION } }, defaults)), ['producer', 'grade', 'quality_doc', 'size', 'heat', 'weight_kg'])
})
