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
