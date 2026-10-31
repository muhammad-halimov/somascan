/**
 * Производитель в правке: поставщик из списка совпадает без учёта регистра и пробелов, иначе — своё название.
 * Порядок списков выбора: выбранные — первыми, снятые — на своих местах.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_KNOWN_SUPPLIERS } from '../src/features/recognition/label/knownSuppliers'
import { selectedFirst } from '../src/lib/list/selectedFirst'
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

test('списки выбора: выбранные — первыми в своём порядке, остальные — на своих местах; ничего не выбрано — как есть', () => {
  const suppliers = ['ArcelorMittal', 'BPM', 'Sovel']
  const chosen = listedSupplier('bpm', suppliers)
  assert.deepEqual(selectedFirst(suppliers, (name) => name === chosen), ['BPM', 'ArcelorMittal', 'Sovel'])
  assert.deepEqual(selectedFirst(suppliers, () => false), suppliers)
  // несколько выбранных (поля бирки): первыми в своём порядке; снятый — снова на своём месте
  const fields = ['producer', 'product', 'grade', 'size', 'heat', 'weight_kg']
  assert.deepEqual(selectedFirst(fields, (key) => ['producer', 'size', 'heat', 'weight_kg'].includes(key)), ['producer', 'size', 'heat', 'weight_kg', 'product', 'grade'])
  assert.deepEqual(selectedFirst(fields, (key) => ['producer', 'heat'].includes(key)), ['producer', 'heat', 'product', 'grade', 'size', 'weight_kg'])
})
