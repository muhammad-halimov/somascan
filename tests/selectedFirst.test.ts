/**
 * Порядок списков выбора: выбранные первыми и порядок, запомненный при раскрытии.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inKeyOrder, selectedFirst } from '../src/lib/list/selectedFirst'

const key = (item: string) => item

test('selectedFirst: выбранные — первыми, остальные — на своих местах', () => {
  assert.deepEqual(selectedFirst(['a', 'b', 'c', 'd'], (item) => item === 'c'), ['c', 'a', 'b', 'd'])
})

test('inKeyOrder: порядок по запомненным ключам', () => {
  assert.deepEqual(inKeyOrder(['a', 'b', 'c', 'd'], ['c', 'a', 'b', 'd'], key), ['c', 'a', 'b', 'd'])
})

test('inKeyOrder: пропавшие убраны, новые — в конце в своём порядке', () => {
  assert.deepEqual(inKeyOrder(['a', 'b', 'x', 'd', 'y'], ['d', 'c', 'a', 'b'], key), ['d', 'a', 'b', 'x', 'y'])
})
