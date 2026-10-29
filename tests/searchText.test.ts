/**
 * Поиск по спискам (поставщики, поля бирки): без регистра и диакритики, по словам в любом порядке.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchesSearch } from '../src/lib/text/searchText'

test('без регистра и диакритики, часть слова', () => {
  assert.ok(matchesSearch('OAM Ózdi Acélművek', 'ozd'))
  assert.ok(matchesSearch('OAM Ózdi Acélművek', 'ACELM'))
  assert.ok(matchesSearch('Номер плавки', 'плав'))
  assert.ok(matchesSearch('Ҷустуҷӯ', 'ҷуст'))
})

test('несколько слов — все должны быть, порядок любой', () => {
  assert.ok(matchesSearch('Suez Steel', 'steel suez'))
  assert.ok(matchesSearch('Diler Demir Celik', '  demir   dil '))
  assert.ok(!matchesSearch('Suez Steel', 'suez ozd'))
})

test('пустой запрос подходит ко всему, чужой — ни к чему', () => {
  assert.ok(matchesSearch('Habas', ''))
  assert.ok(matchesSearch('Habas', '   '))
  assert.ok(!matchesSearch('Habas', 'sovel'))
})
