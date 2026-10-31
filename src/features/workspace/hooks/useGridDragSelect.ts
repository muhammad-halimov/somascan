import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { MOVE_TOLERANCE } from '@/hooks/useLongPress'
import { cssDurationMs, motionTiming, prefersReducedMotion } from '../utils/motion'

/** Класс сетки, пока рамку ведёт палец (`PhotoGrid.css`). */
const DRAGGING_CLASS = 'is-dragging'

/** Класс сетки на кадр, когда рамка сменяется обводкой ячейки: без переходов, иначе свечение проявлялось бы заново. */
const SETTLING_CLASS = 'is-settling'

/** CSS-переменная сетки: сколько рамка переезжает с ячейки на ячейку (так же переезжает обводка ячейки). */
const FRAME_MOVE_VAR = '--photo-grid-frame-move'

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
  /** Рамка переноса (абсолютно в сетке, без событий указателя). */
  frameRef: RefObject<HTMLElement | null>
  /** Бирка под рамкой. */
  activeIndex: number
  /** Сетка на экране. */
  enabled: boolean
  /** Перенести рамку на бирку. */
  onSelect: (index: number) => void
}

/**
 * Перенос рамки открытой бирки пальцем. Рамка всегда стоит на ячейке: переезжает с ячейки на ячейку под пальцем
 * (вверх, вниз, влево, вправо), за края бирок не выходит — палец вне бирок оставляет её на последней.
 * Касание другой бирки сразу переносит рамку туда; с открытой бирки перенос начинается со сдвигом пальца,
 * а простое нажатие на неё открывает бирку. Во время переноса экран не прокручивается, а клик при отпускании
 * гасится (иначе он попал бы в бирку, уже ставшую открытой, и открыл её).
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
    /** Касание открытой бирки: перенос начнётся, когда палец сдвинется. */
    let armed: { x: number; y: number } | null = null
    let current: number | null = null
    let dragging = false
    /** Перенос закончился: клик, который придёт при отпускании пальца, — не нажатие. */
    let swallowClick = false
    let slide: Animation | null = null

    /** Время переезда рамки, мс — из стилей сетки (одно значение с обводкой ячейки). */
    const slideMs = cssDurationMs(getComputedStyle(grid).getPropertyValue(FRAME_MOVE_VAR))
    const cellOf = (index: number | null) => (index === null ? null : grid.querySelector<HTMLElement>(`[data-item-index="${index}"]`))

    /**
     * Область ячейки в сетке (`grid-area`): рамка — абсолютный элемент сетки и встаёт ровно в эту область, тех же
     * размеров, что ячейка, без округления до пикселя. Ячейки идут по порядку, рамка в раскладке не участвует.
     * Конечные линии — явно: у абсолютного элемента `auto` означает край сетки, а не следующую линию.
     */
    const cellArea = (cell: HTMLElement) => {
      const order = Array.from(grid.children).filter((child) => child !== frame).indexOf(cell)
      const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length
      const row = Math.floor(order / columns) + 1
      const column = (order % columns) + 1
      return `${row} / ${column} / ${row + 1} / ${column + 1}`
    }

    /**
     * Рамка переезжает на ячейку с того места, где она сейчас (даже посреди прошлого переезда): встаёт в область
     * ячейки и доезжает до неё сдвигом `translate` — его, в отличие от `transform`, увеличение рамки (`scale`) не умножает.
     */
    const slideTo = (cell: HTMLElement) => {
      const from = frame.getBoundingClientRect()
      slide?.cancel()
      slide = null
      frame.style.gridArea = cellArea(cell)
      if (prefersReducedMotion()) return
      const to = frame.getBoundingClientRect()
      // Сдвиг на экране — в единицах сетки: сетка может быть увеличена вместе с карточкой.
      const zoom = grid.getBoundingClientRect().width / grid.offsetWidth || 1
      const shift = `${(from.left - to.left) / zoom}px ${(from.top - to.top) / zoom}px`
      slide = frame.animate([{ translate: shift }, { translate: '0px 0px' }], motionTiming(slideMs))
    }

    /** Рамка снимается с бирки `from` и переезжает на `to` (та становится открытой). */
    const begin = (from: number, to: number) => {
      const start = cellOf(from) ?? cellOf(to)
      if (!start || !cellOf(to)) return
      dragging = true
      armed = null
      frame.style.gridArea = cellArea(start)
      grid.classList.add(DRAGGING_CLASS)
      navigator.vibrate?.(DRAG_START_VIBRATION_MS)
      moveTo(to)
    }

    const moveTo = (index: number) => {
      const cell = cellOf(index)
      if (!cell) return
      if (index !== current) latest.current.onSelect(index)
      current = index
      slideTo(cell)
    }

    const finish = () => {
      slide = null
      grid.classList.add(SETTLING_CLASS)
      grid.classList.remove(DRAGGING_CLASS)
      frame.style.gridArea = ''
      requestAnimationFrame(() => grid.classList.remove(SETTLING_CLASS))
    }

    const stop = () => {
      armed = null
      if (!dragging) return
      dragging = false
      swallowClick = true
      // Рамка доезжает до ячейки и сменяется обводкой самой ячейки на том же месте.
      if (slide) slide.finished.then(finish, () => {})
      else finish()
    }

    const onTouchStart = (event: TouchEvent) => {
      swallowClick = false
      if (event.touches.length !== 1) return stop()
      const touch = event.touches[0]!
      const index = itemIndexAt(touch.clientX, touch.clientY)
      if (index === null) return
      const active = latest.current.activeIndex
      current = active
      if (index === active) armed = { x: touch.clientX, y: touch.clientY }
      else begin(active, index)
    }

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) return
      if (armed && !dragging) {
        if (Math.hypot(touch.clientX - armed.x, touch.clientY - armed.y) <= MOVE_TOLERANCE) return
        begin(latest.current.activeIndex, latest.current.activeIndex)
      }
      if (!dragging) return
      // Палец ведёт рамку, а не экран.
      if (event.cancelable) event.preventDefault()
      const index = itemIndexAt(touch.clientX, touch.clientY)
      if (index !== null && index !== current) moveTo(index)
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
      slide?.cancel()
      finish()
      grid.removeEventListener('touchstart', onTouchStart)
      grid.removeEventListener('touchmove', onTouchMove)
      grid.removeEventListener('touchend', stop)
      grid.removeEventListener('touchcancel', stop)
      grid.removeEventListener('click', onClick, { capture: true })
    }
  }, [gridRef, frameRef, enabled])
}
