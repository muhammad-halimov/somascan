import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cssDurationMs } from '../src/features/workspace/utils/motion'

test('cssDurationMs: миллисекунды и секунды, в том числе сокращённые сборкой', () => {
  assert.equal(cssDurationMs('260ms'), 260)
  assert.equal(cssDurationMs(' 180ms '), 180)
  assert.equal(cssDurationMs('.26s'), 260)
  assert.equal(cssDurationMs('1.5S'), 1500)
})

test('cssDurationMs: не время — 0', () => {
  assert.equal(cssDurationMs(''), 0)
  assert.equal(cssDurationMs('260'), 0)
  assert.equal(cssDurationMs('auto'), 0)
})
