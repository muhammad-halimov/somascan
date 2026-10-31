import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { MOVE_TOLERANCE } from '@/hooks/useLongPress'
import { motionTiming, prefersReducedMotion } from '../utils/motion'

/** Класс сетки, пока рамку ведёт палец (`PhotoGrid.css`). */
const DRAGGING_CLASS = 'is-dragging'

/**
 * Удержание на бирке без рамки, после которого палец ведёт рамку, мс. С самой рамки перенос начинается сразу,
 * с первым сдвигом пальца; на других бирках сдвиг до удержания — прокрутка экрана.
 */
const DRAG_HOLD_MS = 200

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
 * Перенос рамки открытой бирки пальцем: рамку берут с её бирки (сразу) или с любой другой бирки (после
 * короткого удержания) и ведут по сетке. Рамка едет за пальцем плавно, бирка под пальцем сразу становится
 * открытой; при отпускании рамка доезжает до неё. Во время переноса экран не прокручивается, а клик при
 * отпускании гасится (иначе нажатие на бирку под рамкой открыло бы её).
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
    let holdTimer = 0
    let frameRequest = 0
    let start: { x: number; y: number } | null = null
    let finger = { x: 0, y: 0 }
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
      // Рамка снимается с ячейки и плавно подъезжает под палец.
      frame.style.transform = `translate(${cell.offsetLeft}px, ${cell.offsetTop}px)`
      grid.classList.add(DRAGGING_CLASS)
      navigator.vibrate?.(DRAG_START_VIBRATION_MS)
      if (current !== latest.current.activeIndex && current !== null) latest.current.onSelect(current)
      frameRequest = requestAnimationFrame(placeAtFinger)
    }

    const finish = () => {
      grid.classList.remove(DRAGGING_CLASS)
      frame.style.transform = ''
    }

    const stop = () => {
      window.clearTimeout(holdTimer)
      start = null
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
      if (index === null) return
      start = { x: touch.clientX, y: touch.clientY }
      finger = start
      current = index
      // С рамки перенос начинается с первым сдвигом, с другой бирки — после удержания.
      if (index !== latest.current.activeIndex) holdTimer = window.setTimeout(begin, DRAG_HOLD_MS)
    }

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch || !start) return
      finger = { x: touch.clientX, y: touch.clientY }
      if (!dragging) {
        if (Math.hypot(finger.x - start.x, finger.y - start.y) <= MOVE_TOLERANCE) return
        // Сдвиг с рамки — перенос; с другой бирки до удержания — прокрутка.
        if (current !== latest.current.activeIndex) return stop()
        begin()
      }
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
      window.clearTimeout(holdTimer)
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
