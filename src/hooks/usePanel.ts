import { useCallback, useEffect, useRef, useState } from 'react'
import { useBackHandler } from './useBackHandler'

/** Длительность анимации закрытия; должна совпадать с keyframes `*-exit` в CSS. */
export const PANEL_CLOSE_MS = 220

/**
 * Состояние взаимоисключающих панелей-оверлеев (например, шторки настроек и поповера загрузок).
 *
 * Закрытие двухфазное: `isClosing` включается, чтобы проиграть анимацию выхода, а панель
 * размонтируется через `PANEL_CLOSE_MS`. Кнопка «Назад» на Android закрывает открытую панель.
 */
export function usePanel<T extends string>() {
  const [panel, setPanel] = useState<T | null>(null)
  const [isClosing, setIsClosing] = useState(false)
  /** Синхронное отражение `panel` для обработчиков событий, которые срабатывают между рендерами. */
  const panelRef = useRef<T | null>(null)
  const closeTimer = useRef<number | null>(null)

  /** Открывает `next`, отменяя идущую анимацию закрытия. */
  const open = useCallback((next: T) => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
    panelRef.current = next
    setIsClosing(false)
    setPanel(next)
  }, [])

  /** Проигрывает анимацию выхода, затем размонтирует панель. Повторные вызовы игнорируются. */
  const close = useCallback(() => {
    if (panelRef.current === null || closeTimer.current !== null) return
    setIsClosing(true)
    closeTimer.current = window.setTimeout(() => {
      panelRef.current = null
      closeTimer.current = null
      setPanel(null)
      setIsClosing(false)
    }, PANEL_CLOSE_MS)
  }, [])

  /** Открывает `next` или закрывает её, если она уже открыта. */
  const toggle = useCallback((next: T) => {
    if (panelRef.current === next) close()
    else open(next)
  }, [close, open])

  useBackHandler(panel !== null, close)

  // Не запускаем таймер закрытия после размонтирования.
  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  return { panel, isClosing, open, close, toggle }
}
