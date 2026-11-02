import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { TAP_GUARD_MS, TOUCH_SLOP } from '@/lib/interaction/gestures'
import { scrollParentOf } from '@/lib/interaction/scrollParent'

/**
 * Пока палец не ушёл дальше этого, px, направление свайпа ещё уточняется: первые пиксели касания шумят — большой
 * палец идёт дугой, и свайп вниз часто начинается вкось (читался бы как свайп вбок, и наоборот).
 */
const AXIS_SETTLE_DISTANCE = 4 * TOUCH_SLOP

/** Свайп засчитывается, если палец прошёл в его сторону столько, px, или взмахнул (`FLICK_VELOCITY`). */
const SWIPE_DISTANCE = AXIS_SETTLE_DISTANCE

/** Скорость взмаха, px/мс: быстрее — свайп даже короткий; обратно в конце — передумали. */
const FLICK_VELOCITY = 0.3

/** Скорость пальца — по последним столько мс движения: по одному шагу она скачет. */
const VELOCITY_WINDOW_MS = 80

/** Экран прокручен к началу — с допуском на дробную прокрутку, px. */
const SCROLL_TOP_TOLERANCE = 1

/** Направление свайпа: пока не ясно, вбок, вниз или чужой жест (прокрутка, щипок). */
type Axis = 'pending' | 'x' | 'down' | 'none'

/** Положение пальца во времени — для скорости взмаха. */
interface Sample {
  x: number
  y: number
  at: number
}

/** Параметры `usePhotoSwipe`. */
export interface PhotoSwipeOptions {
  /** Карточка фото: на ней ловим касания. */
  cardRef: RefObject<HTMLElement | null>
  /** Свайпы разрешены (одна бирка, фото не увеличено: тогда палец двигает фото). */
  enabled: boolean
  /** Свайп вправо — предыдущая бирка: то же, что стрелка «назад» (нет — свайп ничего не делает). */
  onPrevious?: () => void
  /** Свайп влево — следующая бирка: то же, что стрелка «вперёд». */
  onNext?: () => void
  /** Свайп вниз — сетка: то же, что кнопка «Сетка». */
  onDown: () => void
}

/**
 * Свайпы по карточке фото одной бирки — те же действия, что у кнопок, с их же анимацией: влево и вправо — стрелки
 * (к соседней бирке), сверху вниз — «Сетка». Фото за пальцем не тянется: свайп засчитывается при отпускании —
 * дальше `SWIPE_DISTANCE` или взмахом (взмах обратно в конце — передумали). Вниз — только когда экран прокручен
 * к началу, иначе это прокрутка.
 * Жест, который может оказаться свайпом, браузер не забирает себе (своя прокрутка и оттяжка края) с первого сдвига;
 * направление уточняется на первых `AXIS_SETTLE_DISTANCE`. Второй палец (щипок) и прокрутка свайпом не считаются;
 * клик сразу после свайпа гасится: конец свайпа не нажимает ни фото, ни кнопки карточки.
 */
export function usePhotoSwipe({ cardRef, enabled, onPrevious, onNext, onDown }: PhotoSwipeOptions) {
  const actions = useRef({ onPrevious, onNext, onDown })
  useLayoutEffect(() => {
    actions.current = { onPrevious, onNext, onDown }
  })

  useEffect(() => {
    const card = cardRef.current
    if (!card || !enabled) return
    let axis: Axis = 'none'
    let start: Sample = { x: 0, y: 0, at: 0 }
    let samples: Sample[] = []
    let lastSwipeAt = -Infinity
    /** Экран прокручен к началу: свайп вниз — к сетке, а не прокрутка. */
    let atTop = true

    /** Направление по сдвигу пальца от начала касания. */
    const axisOf = (dx: number, dy: number): Exclude<Axis, 'pending'> => (Math.abs(dx) > Math.abs(dy) ? 'x' : dy > 0 && atTop ? 'down' : 'none')

    /** Скорость пальца по последним `VELOCITY_WINDOW_MS`. */
    const velocity = () => {
      const last = samples[samples.length - 1]
      const first = last && samples.find((sample) => last.at - sample.at <= VELOCITY_WINDOW_MS)
      if (!last || !first || last.at === first.at) return { x: 0, y: 0 }
      return { x: (last.x - first.x) / (last.at - first.at), y: (last.y - first.y) / (last.at - first.at) }
    }

    /** Свайп на `shift` px (знак — направление) со скоростью пальца `speed` по той же оси засчитан. */
    const isSwipe = (shift: number, speed: number) => {
      const direction = Math.sign(shift)
      const flick = Math.sign(speed) === direction && Math.abs(speed) > FLICK_VELOCITY
      const thrownBack = Math.sign(speed) === -direction && Math.abs(speed) > FLICK_VELOCITY
      return direction !== 0 && !thrownBack && (flick || Math.abs(shift) > SWIPE_DISTANCE)
    }

    /**
     * Узел, которого коснулся палец: браузер шлёт ему всё касание до конца — даже если бирка сменилась и узла уже нет
     * в DOM; тогда до карточки события не всплывают. Поэтому движение и отпускание слушаем на нём.
     */
    let touched: GlobalEventHandlers | null = null
    const track = (node: EventTarget | null) => {
      untrack()
      touched = node instanceof HTMLElement || node instanceof SVGElement ? node : null
      touched?.addEventListener('touchmove', onTouchMove, { passive: false })
      touched?.addEventListener('touchend', onTouchEnd)
      touched?.addEventListener('touchcancel', onTouchCancel)
    }
    const untrack = () => {
      touched?.removeEventListener('touchmove', onTouchMove)
      touched?.removeEventListener('touchend', onTouchEnd)
      touched?.removeEventListener('touchcancel', onTouchCancel)
      touched = null
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        axis = 'none'
        return
      }
      track(event.target)
      const touch = event.touches[0]!
      start = { x: touch.clientX, y: touch.clientY, at: event.timeStamp }
      samples = [start]
      atTop = (scrollParentOf(card)?.scrollTop ?? 0) < SCROLL_TOP_TOLERANCE
      axis = 'pending'
    }

    const onTouchMove = (event: TouchEvent) => {
      if (axis === 'none') return
      // Второй палец — щипок: не свайп.
      if (event.touches.length !== 1) {
        axis = 'none'
        return
      }
      const touch = event.touches[0]!
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      const distance = Math.hypot(dx, dy)
      if (axis === 'pending') {
        // Жест может оказаться свайпом (вбок или вниз от начала экрана) — браузер не начинает свою прокрутку и оттяжку
        // края с первого же сдвига: иначе он забирал жест раньше нас (экран тянулся и отскакивал, свайп не срабатывал).
        const mayBeSwipe = Math.abs(dx) >= Math.abs(dy) || (dy > 0 && atTop)
        if (mayBeSwipe && event.cancelable) event.preventDefault()
        if (distance <= TOUCH_SLOP) return
      }
      if (axis === 'pending' || distance <= AXIS_SETTLE_DISTANCE) {
        const next = axisOf(dx, dy)
        if (next === 'none' && axis === 'pending') {
          axis = 'none'
          return
        }
        if (next !== 'none') axis = next
      }
      // Свайп — не прокрутка экрана.
      if (event.cancelable) event.preventDefault()
      samples.push({ x: touch.clientX, y: touch.clientY, at: event.timeStamp })
      samples = samples.filter((sample) => event.timeStamp - sample.at <= VELOCITY_WINDOW_MS * 2)
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length > 0) return
      untrack()
      const current = axis
      axis = 'none'
      if (current === 'none' || current === 'pending') return
      lastSwipeAt = event.timeStamp
      const last = samples[samples.length - 1] ?? start
      const speed = velocity()
      if (current === 'down') {
        // Как кнопка «Сетка».
        const dy = last.y - start.y
        if (dy > 0 && isSwipe(dy, speed.y)) actions.current.onDown()
        return
      }
      // Как стрелки: вправо — предыдущая бирка, влево — следующая.
      const dx = last.x - start.x
      if (!isSwipe(dx, speed.x)) return
      if (dx > 0) actions.current.onPrevious?.()
      else actions.current.onNext?.()
    }

    const onTouchCancel = () => {
      untrack()
      axis = 'none'
    }

    const onClick = (event: MouseEvent) => {
      if (event.timeStamp - lastSwipeAt >= TAP_GUARD_MS) return
      event.preventDefault()
      event.stopPropagation()
    }

    card.addEventListener('touchstart', onTouchStart, { passive: true })
    card.addEventListener('click', onClick, { capture: true })
    return () => {
      untrack()
      card.removeEventListener('touchstart', onTouchStart)
      card.removeEventListener('click', onClick, { capture: true })
    }
  }, [cardRef, enabled])
}
