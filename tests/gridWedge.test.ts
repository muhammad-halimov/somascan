/**
 * Раскладка сетки «клином»: промежутки вокруг открытой ячейки раздвинуты, у края — поле.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { wedgeLine, wedgeTracks } from '../src/features/workspace/utils/gridWedge'

const G = 'var(--photo-grid-gap)'
const W = 'var(--photo-grid-wedge)'
const C = 'minmax(0, 1fr)'
const A = 'minmax(0, var(--photo-grid-active-fr))'

test('wedgeTracks: без открытой ячейки — все промежутки узкие', () => {
  assert.equal(wedgeTracks(3, null), [G, C, G, C, G, C, G].join(' '))
})

test('wedgeTracks: открытая у края раздвигает поле и соседний промежуток', () => {
  assert.equal(wedgeTracks(3, 0), [W, A, W, C, G, C, G].join(' '))
  assert.equal(wedgeTracks(3, 2), [G, C, G, C, W, A, W].join(' '))
})

test('wedgeTracks: открытая посередине раздвигает оба промежутка', () => {
  assert.equal(wedgeTracks(3, 1), [G, C, W, A, W, C, G].join(' '))
})

test('wedgeLine: ячейки — на чётных линиях после поля', () => {
  assert.deepEqual([0, 1, 2].map(wedgeLine), [2, 4, 6])
})
