import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { LONG_PRESS_MS, MOVE_TOLERANCE } from '@/hooks/useLongPress'

/** Класс сетки, пока рамка идёт за пальцем (`PhotoGrid.css`). */
const DRAGGING_CLASS = 'is-dragging'

/** Короткая вибрация в начале переноса, мс (Android; iOS в WebView не вибрирует). */
const DRAG_START_VIBRATION_MS = 10

/** Ячейка бирки (не пустая) под точкой экрана: её номер или `null`. */
function itemIndexAt(x: number, y: number): number | null {
  const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-item-index]')
  return cell ? Number(cell.dataset.itemIndex) : null
}

/**
 * Перенос рамки открытой бирки удержанием: палец держат на ячейке бирки (`LONG_PRESS_MS`) и ведут по сетке —
 * рамка переходит на бирку под пальцем, при отпускании остаётся на ней. Пока удержание не сработало, сдвиг
 * пальца — обычная прокрутка; во время переноса прокрутка экрана не идёт, а клик при отпускании гасится.
 * Ячейки бирок помечены `data-item-index`.
 * @param gridRef Сетка.
 * @param onSelect Сделать бирку открытой.
 * @param enabled Сетка на экране.
 */
export function useGridDragSelect(gridRef: RefObject<HTMLElement | null>, onSelect: (index: number) => void, enabled: boolean) {
  const select = useRef(onSelect)
  useLayoutEffect(() => {
    select.current = onSelect
  })

  useEffect(() => {
    const grid = gridRef.current
    if (!grid || !enabled) return
    let timer = 0
    let start: { x: number; y: number } | null = null
    let current: number | null = null
    let dragging = false
    /** Перенос закончился: клик, который придёт при отпускании пальца, — не нажатие. */
    let swallowClick = false

    const stop = () => {
      window.clearTimeout(timer)
      start = null
      if (!dragging) return
      dragging = false
      swallowClick = true
      grid.classList.remove(DRAGGING_CLASS)
    }
    const onTouchStart = (event: TouchEvent) => {
      swallowClick = false
      if (event.touches.length !== 1) return stop()
      const touch = event.touches[0]!
      const index = itemIndexAt(touch.clientX, touch.clientY)
      if (index === null) return
      start = { x: touch.clientX, y: touch.clientY }
      current = index
      timer = window.setTimeout(() => {
        dragging = true
        grid.classList.add(DRAGGING_CLASS)
        navigator.vibrate?.(DRAG_START_VIBRATION_MS)
        if (current !== null) select.current(current)
      }, LONG_PRESS_MS)
    }
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch || !start) return
      if (!dragging) {
        if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > MOVE_TOLERANCE) stop()
        return
      }
      // Палец ведёт рамку, а не экран.
      if (event.cancelable) event.preventDefault()
      const index = itemIndexAt(touch.clientX, touch.clientY)
      if (index === null || index === current) return
      current = index
      select.current(index)
    }
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return
      swallowClick = false
      event.preventDefault()
      event.stopPropagation()
    }

    grid.addEventListener('touchstart', onTouchStart, { passive: true })
    grid.addEventListener('touchmove', onTouchMove, { passive: false })
    grid.addEventListener('touchend', stop)
    grid.addEventListener('touchcancel', stop)
    grid.addEventListener('click', onClick, { capture: true })
    return () => {
      stop()
      grid.classList.remove(DRAGGING_CLASS)
      grid.removeEventListener('touchstart', onTouchStart)
      grid.removeEventListener('touchmove', onTouchMove)
      grid.removeEventListener('touchend', stop)
      grid.removeEventListener('touchcancel', stop)
      grid.removeEventListener('click', onClick, { capture: true })
    }
  }, [gridRef, enabled])
}
