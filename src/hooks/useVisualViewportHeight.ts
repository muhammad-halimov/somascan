import { useEffect } from 'react'

/**
 * Публикует геометрию видимой области (без экранной клавиатуры) в CSS-переменные
 * `--visual-viewport-height` и `--visual-viewport-top`: раскладки на всю высоту сжимаются
 * при открытии клавиатуры, а фиксированные окна не уезжают, когда iOS сдвигает видимую область.
 *
 * После изменения размеров поле в фокусе докручивается в видимую часть своего контейнера:
 * браузер делает это только в момент фокуса, ещё до появления клавиатуры.
 */
export function useVisualViewportHeight() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const root = document.documentElement
    let revealTimer = 0

    const update = () => {
      root.style.setProperty('--visual-viewport-height', `${viewport.height}px`)
      root.style.setProperty('--visual-viewport-top', `${viewport.offsetTop}px`)
    }

    /** Поле в фокусе — в видимой части, когда раскладка уже подстроилась под клавиатуру. */
    const revealFocusedField = () => {
      window.clearTimeout(revealTimer)
      revealTimer = window.setTimeout(() => {
        const focused = document.activeElement
        // Скрытое поле (свёрнутый список, неактивная часть экрана) не показываем: прокрутка к нему уводила экран.
        const visible = focused instanceof HTMLElement && !focused.closest('[inert]') && focused.getClientRects().length > 0
        if (visible && focused.matches('input, textarea')) {
          focused.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
      }, 80)
    }

    const onResize = () => {
      update()
      revealFocusedField()
    }

    update()
    viewport.addEventListener('resize', onResize)
    viewport.addEventListener('scroll', update)
    return () => {
      window.clearTimeout(revealTimer)
      viewport.removeEventListener('resize', onResize)
      viewport.removeEventListener('scroll', update)
      root.style.removeProperty('--visual-viewport-height')
      root.style.removeProperty('--visual-viewport-top')
    }
  }, [])
}
