import { useEffect, useLayoutEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

/** Сколько держать палец, мс: как долгое нажатие Android и iOS. */
const LONG_PRESS_MS = 500

/** Палец сдвинулся дальше стольких точек — это прокрутка, а не удержание. */
const MOVE_TOLERANCE = 10

/**
 * Долгое нажатие на кнопку: через полсекунды удержания (или по правой кнопке мыши) вызывает `onLongPress`
 * и гасит клик, который пришёл бы следом при отпускании. Сдвиг пальца отменяет удержание.
 * На Android долгое касание ещё и присылает `contextmenu` — его отменяем: меню нет, а система отвечает
 * короткой вибрацией, как на долгое нажатие в нативном приложении.
 * @returns Обработчики для кнопки (spread).
 */
export function useLongPress(onLongPress: () => void) {
  const callback = useRef(onLongPress)
  useLayoutEffect(() => {
    callback.current = onLongPress
  })
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  /** Удержание сработало: следующий клик — отпускание того же пальца, его гасим. */
  const fired = useRef(false)

  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }
  const fire = () => {
    if (fired.current) return
    fired.current = true
    cancel()
    callback.current()
  }
  useEffect(() => cancel, [])

  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      fired.current = false
      if (event.button !== 0) return
      start.current = { x: event.clientX, y: event.clientY }
      timer.current = window.setTimeout(fire, LONG_PRESS_MS)
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > MOVE_TOLERANCE) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault()
      fire()
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (!fired.current) return
      fired.current = false
      event.preventDefault()
      event.stopPropagation()
    },
  }
}
