/**
 * Производитель в правке: поставщик из списка совпадает без учёта регистра и пробелов, иначе — своё название.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_KNOWN_SUPPLIERS } from '../src/features/recognition/label/knownSuppliers'
import { listedSupplier } from '../src/features/workspace/utils/producerChoice'

test('название из списка — написанием списка, без учёта регистра и пробелов', () => {
  assert.equal(listedSupplier('OAM Ózdi Acélművek', DEFAULT_KNOWN_SUPPLIERS), 'OAM Ózdi Acélművek')
  assert.equal(listedSupplier('  SOVEL ', DEFAULT_KNOWN_SUPPLIERS), 'Sovel')
})

test('название не из списка и пустое — не поставщик из списка', () => {
  assert.equal(listedSupplier('ArcelorMittal Kryvyi Rih', DEFAULT_KNOWN_SUPPLIERS), null)
  assert.equal(listedSupplier('', DEFAULT_KNOWN_SUPPLIERS), null)
  assert.equal(listedSupplier('Sovel', []), null)
})
