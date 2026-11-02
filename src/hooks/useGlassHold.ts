import { useCallback, useRef, type RefObject } from 'react'

/** Класс окна, пока в нём что-то движется: стекло не размывает экран (см. `styles/platform-ios.css`). */
const GLASS_HOLD_CLASS = 'is-moving'

/**
 * Стекло окна (Liquid Glass: «Настройки», «Загрузки») на время движения внутри него. Размытие фона под большим окном —
 * самая дорогая работа GPU: пока в окне что-то движется (плашка вкладок, смена вкладки, высота окна), оно
 * пересчитывается на каждом кадре, и кадры шли вдвое дольше. На это время окно — того же оттенка, чуть плотнее,
 * без размытия; когда движение закончилось, размытие возвращается (его считают один раз).
 * @returns `hold()` — вызвать, когда в окне начинается движение (после него — снова, если движение продлилось).
 */
export function useGlassHold(ref: RefObject<HTMLElement | null>) {
  const token = useRef(0)
  return useCallback(() => {
    const element = ref.current
    if (!element) return
    element.classList.add(GLASS_HOLD_CLASS)
    const current = ++token.current
    // Анимации и переходы этого кадра уже начались — ждём их конца (бесконечные — спиннеры — не ждём).
    window.requestAnimationFrame(() => {
      const running = element.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
      void Promise.all(running.map((animation) => animation.finished.catch(() => undefined))).then(() => {
        if (token.current === current) element.classList.remove(GLASS_HOLD_CLASS)
      })
    })
  }, [ref])
}
