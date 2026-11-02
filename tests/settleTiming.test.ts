import assert from 'node:assert/strict'
import { test } from 'node:test'
import { settleTiming } from '../src/features/workspace/utils/motion'

/** Начальная скорость доезда, px/мс: наклон кривой в начале × путь / время. */
function startSpeed(distance: number, speed: number) {
  const { duration, easing } = settleTiming(distance, speed)
  const [x1, y1] = /cubic-bezier\(([^,]+), ([^,]+),/.exec(easing)!.slice(1).map(Number)
  return ((y1! / x1!) * Math.abs(distance)) / duration
}

test('settleTiming: доезд отрывается от пальца с его скоростью', () => {
  for (const [distance, speed] of [[250, 0.5], [250, 1.5], [300, 0.3], [60, 0.8]] as const) {
    assert.ok(Math.abs(startSpeed(distance, speed) - speed) < 0.01, `${distance} px при ${speed} px/мс`)
  }
})

test('settleTiming: быстрый взмах — короче, медленный — не дольше предела', () => {
  assert.ok(settleTiming(250, 3).duration < settleTiming(250, 1).duration)
  assert.equal(settleTiming(380, 0.2).duration, 300)
  assert.equal(settleTiming(380, 50).duration, 160)
})

test('settleTiming: палец стоял — доезд с места, короткий сдвиг — быстро', () => {
  assert.equal(settleTiming(14, 0).easing, 'cubic-bezier(0.33, 0, 0.68, 1)')
  assert.equal(settleTiming(14, 0).duration, 160)
  assert.equal(settleTiming(-40, -1).easing, 'cubic-bezier(0.33, 0, 0.68, 1)')
})
