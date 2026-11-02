import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { TAP_GUARD_MS, TOUCH_SLOP } from '@/lib/interaction/gestures'
import { scrollParentOf } from '@/lib/interaction/scrollParent'
import { motionTiming, prefersReducedMotion } from '../utils/motion'

/** Свайп длиннее этой доли ширины (высоты) карточки — переход: к соседней бирке (к сетке). */
const COMMIT_DISTANCE = 0.25

/** Или быстрый взмах: скорость пальца в конце, px/мс. */
const COMMIT_VELOCITY = 0.4

/** Соседней бирки нет — фото тянется за пальцем с сопротивлением, во столько раз слабее. */
const EDGE_RESISTANCE = 0.3

/** Свайп вниз: фото едет за пальцем слабее (тянется к сетке) и чуть уменьшается — до этой доли. */
const DOWN_FOLLOW = 0.5
const DOWN_SHRINK = 0.06

/** Фото, которое не дотянули до перехода, возвращается на место за столько мс. */
const SETTLE_MS = 200

/** Направление свайпа: пока не ясно, вбок, вниз или чужой жест (прокрутка, щипок). */
type Axis = 'pending' | 'x' | 'down' | 'none'

/** Параметры `usePhotoSwipe`. */
export interface PhotoSwipeOptions {
  /** Карточка фото: на ней ловим касания. */
  cardRef: RefObject<HTMLElement | null>
  /** Слой одной бирки: едет за пальцем (`translate` и `scale`, не мешают анимациям `transform`). */
  stageRef: RefObject<HTMLElement | null>
  /** Свайпы разрешены (одна бирка, фото не увеличено: тогда палец двигает фото). */
  enabled: boolean
  /** Свайп вправо — предыдущая бирка (нет — фото только тянется и возвращается). */
  onPrevious?: () => void
  /** Свайп влево — следующая бирка. */
  onNext?: () => void
  /** Свайп вниз — сетка. */
  onDown: () => void
}

/**
 * Свайпы по карточке фото одной бирки: влево и вправо — к соседней бирке, сверху вниз — к сетке. Фото едет за
 * пальцем; отпустили дальше `COMMIT_DISTANCE` или взмахом — переход (новое фото въезжает сбоку, сетка — как по
 * кнопке), иначе фото возвращается на место. Свайп вниз — только когда экран прокручен к началу, иначе это
 * прокрутка. Второй палец (щипок) и прокрутка свайпом не считаются. Клик, пришедший сразу после свайпа, гасится:
 * конец свайпа не нажимает ни фото, ни кнопки карточки.
 */
export function usePhotoSwipe({ cardRef, stageRef, enabled, onPrevious, onNext, onDown }: PhotoSwipeOptions) {
  const actions = useRef({ onPrevious, onNext, onDown })
  useLayoutEffect(() => {
    actions.current = { onPrevious, onNext, onDown }
  })
  useEffect(() => {
    const card = cardRef.current
    const stage = stageRef.current
    if (!card || !stage || !enabled) return
    let axis: Axis = 'none'
    let start = { x: 0, y: 0 }
    let last = { x: 0, y: 0, at: 0 }
    let velocity = { x: 0, y: 0 }
    let lastSwipeAt = -Infinity

    const place = (dx: number, dy: number) => {
      stage.style.translate = `${dx}px ${dy}px`
      stage.style.scale = dy > 0 ? String(1 - DOWN_SHRINK * Math.min(1, dy / card.clientHeight)) : ''
    }
    const clear = () => {
      stage.style.translate = ''
      stage.style.scale = ''
    }
    /** Фото возвращается на место плавно. */
    const settle = () => {
      const from = { translate: stage.style.translate, scale: stage.style.scale || '1' }
      clear()
      if (!prefersReducedMotion()) stage.animate([from, { translate: '0px 0px', scale: '1' }], motionTiming(SETTLE_MS))
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        axis = 'none'
        return
      }
      const touch = event.touches[0]!
      start = { x: touch.clientX, y: touch.clientY }
      last = { ...start, at: event.timeStamp }
      velocity = { x: 0, y: 0 }
      axis = 'pending'
    }

    const onTouchMove = (event: TouchEvent) => {
      if (axis === 'none') return
      if (event.touches.length !== 1) {
        // Второй палец — щипок: свайп отменяется.
        if (axis !== 'pending') settle()
        axis = 'none'
        return
      }
      const touch = event.touches[0]!
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      if (axis === 'pending') {
        if (Math.hypot(dx, dy) <= TOUCH_SLOP) return
        const atTop = (scrollParentOf(card)?.scrollTop ?? 0) <= 0
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : dy > 0 && atTop ? 'down' : 'none'
        if (axis === 'none') return
      }
      // Палец ведёт фото, а не экран.
      if (event.cancelable) event.preventDefault()
      const elapsed = event.timeStamp - last.at
      if (elapsed > 0) velocity = { x: (touch.clientX - last.x) / elapsed, y: (touch.clientY - last.y) / elapsed }
      last = { x: touch.clientX, y: touch.clientY, at: event.timeStamp }
      if (axis === 'x') {
        const hasTarget = dx > 0 ? actions.current.onPrevious : actions.current.onNext
        place(hasTarget ? dx : dx * EDGE_RESISTANCE, 0)
      } else {
        place(0, Math.max(0, dy) * DOWN_FOLLOW)
      }
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (axis === 'none' || axis === 'pending' || event.touches.length > 0) {
        if (event.touches.length === 0) axis = 'none'
        return
      }
      lastSwipeAt = event.timeStamp
      const dx = last.x - start.x
      const dy = last.y - start.y
      if (axis === 'x') {
        const go = dx > 0 ? actions.current.onPrevious : actions.current.onNext
        const far = Math.abs(dx) > card.clientWidth * COMMIT_DISTANCE || Math.abs(velocity.x) > COMMIT_VELOCITY
        if (go && far && Math.sign(velocity.x || dx) === Math.sign(dx)) {
          // Новое фото въезжает сбоку само (слайд карточки): старое просто уступает ему место.
          clear()
          go()
        } else {
          settle()
        }
      } else {
        const far = dy > card.clientHeight * COMMIT_DISTANCE || velocity.y > COMMIT_VELOCITY
        if (far && velocity.y >= 0) {
          // Переход к сетке анимирует слой сам (`transform`): сдвиг пальца снимаем до него.
          clear()
          actions.current.onDown()
        } else {
          settle()
        }
      }
      axis = 'none'
    }

    const onClick = (event: MouseEvent) => {
      if (event.timeStamp - lastSwipeAt >= TAP_GUARD_MS) return
      event.preventDefault()
      event.stopPropagation()
    }

    card.addEventListener('touchstart', onTouchStart, { passive: true })
    card.addEventListener('touchmove', onTouchMove, { passive: false })
    card.addEventListener('touchend', onTouchEnd)
    card.addEventListener('touchcancel', onTouchEnd)
    card.addEventListener('click', onClick, { capture: true })
    return () => {
      clear()
      card.removeEventListener('touchstart', onTouchStart)
      card.removeEventListener('touchmove', onTouchMove)
      card.removeEventListener('touchend', onTouchEnd)
      card.removeEventListener('touchcancel', onTouchEnd)
      card.removeEventListener('click', onClick, { capture: true })
    }
  }, [cardRef, stageRef, enabled])
}
