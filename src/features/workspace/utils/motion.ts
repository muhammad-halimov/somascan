/**
 * Движение в рабочей области: длительности и кривые платформы и проверка «уменьшить движение».
 * Android — Material 3 emphasized, iOS — системная кривая UIKit (как у переходов UINavigationController).
 */

/** Пользователь просил уменьшить движение: переходы без анимации. */
export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Длительность и кривая переходов платформы; `duration` — своя длительность (например, у исчезновения). */
export function motionTiming(duration?: number): KeyframeAnimationOptions {
  return document.documentElement.dataset.platform === 'ios'
    ? { duration: duration ?? 420, easing: 'cubic-bezier(.32, .72, 0, 1)' }
    : { duration: duration ?? 400, easing: 'cubic-bezier(.2, 0, 0, 1)' }
}

/**
 * Длительность из CSS (`180ms`, `.26s`) в миллисекундах; не время — 0. Сборка сокращает значения CSS-переменных
 * (`260ms` → `.26s`), поэтому единицу читаем, а не считаем миллисекундами.
 */
export function cssDurationMs(value: string): number {
  const match = /^\s*(-?[\d.]+)(ms|s)\s*$/i.exec(value)
  if (!match) return 0
  const amount = Number.parseFloat(match[1]!)
  if (!Number.isFinite(amount)) return 0
  return match[2]!.toLowerCase() === 's' ? amount * 1000 : amount
}

/** Опорные точки кривой доезда — easeOutCubic (`cubic-bezier(0.33, 1, 0.68, 1)`). */
const SETTLE_X1 = 0.33
const SETTLE_X2 = 0.68

/** Начальная скорость easeOutCubic — втрое больше средней. */
const SETTLE_SLOPE = 1 / SETTLE_X1

/** Палец медленнее этого, px/мс, — считается стоящим: доезд тогда — по расстоянию (короткий сдвиг — быстро). */
const SETTLE_MIN_SPEED = 1

/** Границы длительности доезда, мс. */
const SETTLE_MIN_MS = 160
const SETTLE_MAX_MS = 300

/**
 * Доезд после того, как палец отпустил то, что вёл (фото при перелистывании): с той скоростью, с какой палец его
 * вёл, и плавной остановкой — без рывка и без замирания в момент отпускания. Быстрый взмах — короткий доезд,
 * медленный — длиннее (до `SETTLE_MAX_MS`); начальный наклон кривой подогнан так, что скорость в первый кадр — скорость
 * пальца.
 * @param distance Сколько осталось проехать, px.
 * @param speed Скорость пальца в сторону цели, px/мс (от цели или стоял — 0).
 */
export function settleTiming(distance: number, speed: number): { duration: number; easing: string } {
  const length = Math.abs(distance)
  const toward = Math.max(0, speed)
  const duration = Math.min(SETTLE_MAX_MS, Math.max(SETTLE_MIN_MS, (SETTLE_SLOPE * length) / Math.max(toward, SETTLE_MIN_SPEED)))
  // Наклон кривой в начале (доля пути на долю времени), при котором фото отрывается от пальца с его скоростью.
  const slope = length > 0 ? (toward * duration) / length : 0
  const x1 = slope > SETTLE_SLOPE ? 1 / slope : SETTLE_X1
  const y1 = Math.min(1, x1 * slope)
  const round = (value: number) => Math.round(value * 1000) / 1000
  return { duration: Math.round(duration), easing: `cubic-bezier(${round(x1)}, ${round(y1)}, ${SETTLE_X2}, 1)` }
}
