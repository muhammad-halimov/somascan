/**
 * MD5 сверяется с Node `crypto` на разных длинах (границы блоков 55/56/64 байта).
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { md5Hex } from '../src/lib/encoding/md5'

test('md5 совпадает с crypto', () => {
  for (const length of [0, 1, 3, 55, 56, 63, 64, 65, 1000, 100_003]) {
    const bytes = new Uint8Array(length).map((_, index) => (index * 31 + 7) & 0xff)
    assert.equal(md5Hex(bytes), createHash('md5').update(bytes).digest('hex'), `длина ${length}`)
  }
  assert.equal(md5Hex(new TextEncoder().encode('abc')), '900150983cd24fb0d6963f7d28e17f72')
})
