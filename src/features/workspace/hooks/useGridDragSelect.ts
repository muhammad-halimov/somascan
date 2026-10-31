import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { motionTiming, prefersReducedMotion } from '../utils/motion'

/** Класс сетки, пока рамку ведёт палец (`PhotoGrid.css`). */
const DRAGGING_CLASS = 'is-dragging'

/** Короткая вибрация в начале переноса, мс (Android; iOS в WebView не вибрирует). */
const DRAG_START_VIBRATION_MS = 10

/** Ячейка бирки (не пустая) под точкой экрана: её номер или `null`. */
function itemIndexAt(x: number, y: number): number | null {
  const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-item-index]')
  return cell ? Number(cell.dataset.itemIndex) : null
}

/** Параметры `useGridDragSelect`. */
export interface GridDragSelectOptions {
  /** Сетка; ячейки бирок помечены `data-item-index`. */
  gridRef: RefObject<HTMLElement | null>
  /** Рамка, которая едет за пальцем (абсолютно в сетке, без событий указателя). */
  frameRef: RefObject<HTMLElement | null>
  /** Бирка под рамкой. */
  activeIndex: number
  /** Сетка на экране. */
  enabled: boolean
  /** Перенести рамку на бирку. */
  onSelect: (index: number) => void
}

/**
 * Перенос рамки открытой бирки пальцем: куда палец встал (на любую бирку, кроме открытой), туда рамка и бежит,
 * а дальше едет за пальцем по сетке; бирка под пальцем сразу становится открытой, при отпускании рамка доезжает
 * до неё. На открытой бирке перенос не начинается: нажатие на неё открывает бирку. Во время переноса экран
 * не прокручивается, а клик при отпускании гасится (иначе он попал бы в бирку, уже ставшую открытой, и открыл её).
 */
export function useGridDragSelect({ gridRef, frameRef, activeIndex, enabled, onSelect }: GridDragSelectOptions) {
  const latest = useRef({ activeIndex, onSelect })
  useLayoutEffect(() => {
    latest.current = { activeIndex, onSelect }
  })

  useEffect(() => {
    const grid = gridRef.current
    const frame = frameRef.current
    if (!grid || !frame || !enabled) return
    let frameRequest = 0
    let finger = { x: 0, y: 0 }
    /** Рамка, с которой начался перенос (открытая бирка): отсюда она бежит к пальцу. */
    let origin: number | null = null
    let current: number | null = null
    let dragging = false
    /** Перенос закончился: клик, который придёт при отпускании пальца, — не нажатие. */
    let swallowClick = false
    /** Рамка — размером с ячейку, центр — под пальцем (координаты сетки). */
    let gridBox = grid.getBoundingClientRect()
    let frameSize = { width: 0, height: 0 }

    const cellOf = (index: number | null) => (index === null ? null : grid.querySelector<HTMLElement>(`[data-item-index="${index}"]`))
    const placeAtFinger = () => {
      frameRequest = 0
      frame.style.transform = `translate(${finger.x - gridBox.left - frameSize.width / 2}px, ${finger.y - gridBox.top - frameSize.height / 2}px)`
    }

    const begin = () => {
      const cell = cellOf(current)
      if (!cell) return
      dragging = true
      gridBox = grid.getBoundingClientRect()
      frameSize = { width: cell.offsetWidth, height: cell.offsetHeight }
      frame.style.width = `${frameSize.width}px`
      frame.style.height = `${frameSize.height}px`
      // Рамка снимается с открытой бирки (если та — бирка, а не пустая ячейка) и бежит под палец.
      const from = cellOf(origin) ?? cell
      frame.style.transform = `translate(${from.offsetLeft}px, ${from.offsetTop}px)`
      grid.classList.add(DRAGGING_CLASS)
      navigator.vibrate?.(DRAG_START_VIBRATION_MS)
      if (current !== null) latest.current.onSelect(current)
      frameRequest = requestAnimationFrame(placeAtFinger)
    }

    const finish = () => {
      grid.classList.remove(DRAGGING_CLASS)
      frame.style.transform = ''
    }

    const stop = () => {
      if (!dragging) return
      dragging = false
      swallowClick = true
      cancelAnimationFrame(frameRequest)
      frameRequest = 0
      // Рамка доезжает до бирки, на которой отпустили палец.
      const cell = cellOf(current)
      if (!cell || prefersReducedMotion()) return finish()
      const from = frame.style.transform
      const to = `translate(${cell.offsetLeft}px, ${cell.offsetTop}px)`
      frame.style.transform = to
      frame.animate([{ transform: from }, { transform: to }], motionTiming()).finished.then(finish, finish)
    }

    const onTouchStart = (event: TouchEvent) => {
      swallowClick = false
      if (event.touches.length !== 1) return stop()
      const touch = event.touches[0]!
      const index = itemIndexAt(touch.clientX, touch.clientY)
      // На открытой бирке перенос не начинается: нажатие на неё открывает бирку.
      if (index === null || index === latest.current.activeIndex) return
      finger = { x: touch.clientX, y: touch.clientY }
      origin = latest.current.activeIndex
      current = index
      begin()
    }

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch || !dragging) return
      finger = { x: touch.clientX, y: touch.clientY }
      // Палец ведёт рамку, а не экран.
      if (event.cancelable) event.preventDefault()
      if (!frameRequest) frameRequest = requestAnimationFrame(placeAtFinger)
      const index = itemIndexAt(finger.x, finger.y)
      if (index === null || index === current) return
      current = index
      latest.current.onSelect(index)
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
      cancelAnimationFrame(frameRequest)
      finish()
      grid.removeEventListener('touchstart', onTouchStart)
      grid.removeEventListener('touchmove', onTouchMove)
      grid.removeEventListener('touchend', stop)
      grid.removeEventListener('touchcancel', stop)
      grid.removeEventListener('click', onClick, { capture: true })
    }
  }, [gridRef, frameRef, enabled])
}
