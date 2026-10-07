import { useEffect, useState } from 'react'

/** Длительность анимации исчезновения по умолчанию, мс (совпадает с `*-exit` в `styles/animations.css`). */
export const EXIT_ANIMATION_MS = 200

/** Фаза показа элемента. */
type Phase = 'open' | 'closing' | 'closed'

/**
 * Держит элемент в DOM, пока проигрывается анимация исчезновения.
 *
 * Когда `open` становится `false`, элемент ещё `durationMs` остаётся смонтированным
 * с `closing = true` (повесьте на него класс `is-closing`), и только потом убирается.
 * Повторное открытие во время исчезновения отменяет его.
 */
export function usePresence(open: boolean, durationMs = EXIT_ANIMATION_MS) {
  const [phase, setPhase] = useState<Phase>(open ? 'open' : 'closed')

  // Подстраиваем фазу прямо во время рендера (рекомендованный React-приём вместо эффекта).
  if (open && phase !== 'open') setPhase('open')
  else if (!open && phase === 'open') setPhase('closing')

  useEffect(() => {
    if (phase !== 'closing') return
    const timer = window.setTimeout(() => setPhase('closed'), durationMs)
    return () => window.clearTimeout(timer)
  }, [phase, durationMs])

  return {
    /** Элемент нужно рендерить. */
    mounted: phase !== 'closed',
    /** Идёт анимация исчезновения. */
    closing: phase === 'closing',
  }
}
