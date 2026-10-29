/**
 * Выбор производителя в правке: поставщик из списка или отдельный вариант «нет в списке».
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_KNOWN_SUPPLIERS } from '../src/features/recognition/label/knownSuppliers'
import { OWN_PRODUCER, producerChoice } from '../src/features/workspace/utils/producerChoice'

test('название из списка выбирается написанием списка, без учёта регистра и пробелов', () => {
  assert.deepEqual(producerChoice('OAM Ózdi Acélművek', DEFAULT_KNOWN_SUPPLIERS), { selected: 'OAM Ózdi Acélművek', unlisted: null })
  assert.deepEqual(producerChoice('  SOVEL ', DEFAULT_KNOWN_SUPPLIERS), { selected: 'Sovel', unlisted: null })
})

test('название не из списка — отдельный вариант, пустое — не выбрано', () => {
  assert.deepEqual(producerChoice('ArcelorMittal Kryvyi Rih', DEFAULT_KNOWN_SUPPLIERS), { selected: 'ArcelorMittal Kryvyi Rih', unlisted: 'ArcelorMittal Kryvyi Rih' })
  assert.deepEqual(producerChoice('', DEFAULT_KNOWN_SUPPLIERS), { selected: '', unlisted: null })
  assert.deepEqual(producerChoice('Sovel', []), { selected: 'Sovel', unlisted: 'Sovel' })
})

test('«Свой вариант» не совпадает ни с одним названием', () => {
  assert.ok(!DEFAULT_KNOWN_SUPPLIERS.includes(OWN_PRODUCER))
  assert.equal(producerChoice(OWN_PRODUCER, DEFAULT_KNOWN_SUPPLIERS).unlisted, OWN_PRODUCER)
})
