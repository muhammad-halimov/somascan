import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { TOUCH_SLOP } from '@/lib/interaction/gestures'
import { cssDurationMs, motionTiming, prefersReducedMotion } from '../utils/motion'

/** Класс сетки, пока рамка переезжает — её ведёт палец или открытая бирка сменилась (`PhotoGrid.css`). */
const MOVING_CLASS = 'is-frame-moving'

/** Класс сетки на кадр, когда рамка сменяется обводкой ячейки: без переходов, иначе свечение проявлялось бы заново. */
const SETTLING_CLASS = 'is-settling'

/** CSS-переменная сетки: сколько рамка переезжает с ячейки на ячейку. */
const FRAME_MOVE_VAR = '--photo-grid-frame-move'

/** Кружок выбора бирки для отправки в ячейке (PhotoGrid): касание его только отмечает бирку, рамку не переносит. */
const SELECT_TOGGLE = '.photo-grid-select'

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
 * Открытая бирка сменилась не пальцем (стрелки панели листания, номер в карточке результата) — рамка так же плавно
 * переезжает со старой ячейки на новую, а не перескакивает.
 * Касание другой бирки сразу переносит рамку туда; с открытой бирки перенос начинается со сдвигом пальца,
 * а простое нажатие на неё открывает бирку. Кружок выбора любой бирки рамку не трогает — нажатие на него только
 * отмечает бирку для отправки или снимает отметку. Во время переноса экран не прокручивается, а клик при отпускании
 * гасится (иначе он попал бы в бирку, уже ставшую открытой, и открыл её).
 */
export function useGridDragSelect({ gridRef, frameRef, activeIndex, enabled, onSelect }: GridDragSelectOptions) {
  const latest = useRef({ activeIndex, onSelect })
  useLayoutEffect(() => {
    latest.current = { activeIndex, onSelect }
  })
  /** Переезд рамки с ячейки на ячейку, пока сетка на экране (иначе null). */
  const glideRef = useRef<((from: number, to: number) => void) | null>(null)
  /** Ячейка, на которой рамка стоит на экране. */
  const shownIndex = useRef(activeIndex)
  // До отрисовки: рамка стоит на старой ячейке и сразу едет, обводка новой не мелькает.
  useLayoutEffect(() => {
    const from = shownIndex.current
    shownIndex.current = activeIndex
    if (from !== activeIndex) glideRef.current?.(from, activeIndex)
  }, [activeIndex])

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

    /** Время переезда рамки, мс — из стилей сетки. */
    const slideMs = cssDurationMs(getComputedStyle(grid).getPropertyValue(FRAME_MOVE_VAR))
    const cellOf = (index: number | null) => (index === null ? null : grid.querySelector<HTMLElement>(`[data-item-index="${index}"]`))
    /** Ячейка позиции — бирки или пустая («плюс»): ячейки идут по порядку. */
    const cellAt = (index: number) => Array.from(grid.children).filter((child) => child !== frame)[index] as HTMLElement | undefined

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
     * ячейки и доезжает до неё сдвигом `translate`.
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
      grid.classList.add(MOVING_CLASS)
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
      grid.classList.remove(MOVING_CLASS)
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

    /**
     * Открытая бирка сменилась не пальцем: рамка встаёт на старую ячейку (или едет оттуда, где она сейчас, если
     * прошлый переезд не закончен) и доезжает до новой, затем сменяется обводкой ячейки.
     */
    glideRef.current = (from, to) => {
      const start = cellAt(from)
      const end = cellAt(to)
      if (dragging || !start || !end || prefersReducedMotion()) return
      if (!grid.classList.contains(MOVING_CLASS)) {
        frame.style.gridArea = cellArea(start)
        grid.classList.add(MOVING_CLASS)
      }
      slideTo(end)
      // Новый переезд или перенос пальцем отменяет этот — тогда рамку снимает он.
      slide?.finished.then(finish, () => {})
    }

    const onTouchStart = (event: TouchEvent) => {
      swallowClick = false
      if (event.touches.length !== 1) return stop()
      if (event.target instanceof Element && event.target.closest(SELECT_TOGGLE)) return
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
        if (Math.hypot(touch.clientX - armed.x, touch.clientY - armed.y) <= TOUCH_SLOP) return
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
      glideRef.current = null
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
