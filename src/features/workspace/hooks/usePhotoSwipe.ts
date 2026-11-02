import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { TAP_GUARD_MS, TOUCH_SLOP } from '@/lib/interaction/gestures'
import { scrollParentOf } from '@/lib/interaction/scrollParent'
import { motionTiming, prefersReducedMotion } from '../utils/motion'

/** Свайп длиннее этой доли ширины (высоты) карточки — переход: к соседней бирке (к сетке). */
const COMMIT_DISTANCE = 0.2

/** Или быстрый взмах в ту же сторону: скорость пальца, px/мс. */
const COMMIT_VELOCITY = 0.3

/** Скорость пальца — по последним столько мс движения: по одному шагу она скачет. */
const VELOCITY_WINDOW_MS = 80

/** Соседней бирки нет — фото тянется за пальцем с сопротивлением, во столько раз слабее. */
const EDGE_RESISTANCE = 0.3

/** Свайп вниз: фото едет за пальцем слабее (тянется к сетке) и чуть уменьшается — до этой доли. */
const DOWN_FOLLOW = 0.5
const DOWN_SHRINK = 0.06

/** Перелистывание доезжает, а недотянутое фото возвращается за столько мс. */
const PAGE_MS = 240

/** Класс карточки, пока фото листают вбок: соседние бирки видны, фото и они едут на `SWIPE_VAR` (PhotoCard.css). */
const SWIPING_CLASS = 'is-swiping'

/** CSS-переменная карточки: сдвиг фото и соседних бирок, px (`@property` — её можно анимировать). */
const SWIPE_VAR = '--photo-swipe'

/** CSS-переменная карточки: зазор между фото и соседней биркой. */
const PAGE_GAP_VAR = '--photo-page-gap'

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
  /** Карточка фото: на ней ловим касания и держим сдвиг (`SWIPE_VAR`). */
  cardRef: RefObject<HTMLElement | null>
  /** Слой одной бирки: при свайпе вниз едет за пальцем (`translate` и `scale`, не мешают анимациям `transform`). */
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
 * Свайпы по карточке фото одной бирки: влево и вправо — к соседней бирке, сверху вниз — к сетке.
 *
 * Вбок — как галерея: фото едет за пальцем, соседняя бирка (`PhotoPeek`) въезжает рядом, без пустого места; кнопки
 * поверх фото стоят. Отпустили дальше `COMMIT_DISTANCE` или взмахом — фото доезжает, соседняя бирка встаёт на его
 * место, и только тогда бирка сменяется (`land` — без своего слайда); иначе фото плавно возвращается.
 * Вниз — фото тянется за пальцем и чуть уменьшается; дальше порога — сетка, как по кнопке. Только когда экран
 * прокручен к началу, иначе это прокрутка. Второй палец (щипок) и прокрутка свайпом не считаются; клик сразу после
 * свайпа гасится: конец свайпа не нажимает ни фото, ни кнопки карточки.
 * @returns `land()` — вызвать, когда открытая бирка сменилась: снимает доехавший сдвиг до кадра; `true` — бирку
 * сменил свайп, и её фото уже на месте (свой слайд не нужен).
 */
export function usePhotoSwipe({ cardRef, stageRef, enabled, onPrevious, onNext, onDown }: PhotoSwipeOptions) {
  const actions = useRef({ onPrevious, onNext, onDown })
  useLayoutEffect(() => {
    actions.current = { onPrevious, onNext, onDown }
  })
  /** Доехавшее перелистывание: держит соседнюю бирку на месте фото, пока бирка не сменится. */
  const landing = useRef<Animation | null>(null)

  useEffect(() => {
    const card = cardRef.current
    const stage = stageRef.current
    if (!card || !stage || !enabled) return
    let axis: Axis = 'none'
    let start: Sample = { x: 0, y: 0, at: 0 }
    let samples: Sample[] = []
    let offset = 0
    let lastSwipeAt = -Infinity
    let moving: Animation | null = null

    const setOffset = (px: number) => {
      offset = px
      card.style.setProperty(SWIPE_VAR, `${px}px`)
    }
    const stopSwiping = () => {
      card.classList.remove(SWIPING_CLASS)
      card.style.removeProperty(SWIPE_VAR)
      offset = 0
    }
    /** Сдвиг плавно доезжает до `to` (держится там, пока его не снимут); по окончании — `done`. */
    const slideTo = (to: number, done: (animation: Animation | null) => void) => {
      moving?.cancel()
      const from = offset
      setOffset(to)
      if (prefersReducedMotion()) return done(null)
      const animation = card.animate([{ [SWIPE_VAR]: `${from}px` }, { [SWIPE_VAR]: `${to}px` }], { ...motionTiming(PAGE_MS), fill: 'forwards' })
      moving = animation
      animation.finished.then(() => {
        if (moving !== animation) return
        moving = null
        done(animation)
      }, () => {})
    }

    /** Свайп вниз: фото тянется за пальцем и чуть уменьшается. */
    const pull = (dy: number) => {
      stage.style.translate = `0 ${dy}px`
      stage.style.scale = String(1 - DOWN_SHRINK * Math.min(1, dy / card.clientHeight))
    }
    const unpull = () => {
      stage.style.translate = ''
      stage.style.scale = ''
    }
    const release = () => {
      const from = { translate: stage.style.translate || '0px 0px', scale: stage.style.scale || '1' }
      unpull()
      if (!prefersReducedMotion()) stage.animate([from, { translate: '0px 0px', scale: '1' }], motionTiming(PAGE_MS))
    }

    /** Скорость пальца по последним `VELOCITY_WINDOW_MS`. */
    const velocity = () => {
      const last = samples[samples.length - 1]
      const first = last && samples.find((sample) => last.at - sample.at <= VELOCITY_WINDOW_MS)
      if (!last || !first || last.at === first.at) return { x: 0, y: 0 }
      return { x: (last.x - first.x) / (last.at - first.at), y: (last.y - first.y) / (last.at - first.at) }
    }

    const onTouchStart = (event: TouchEvent) => {
      // Пока перелистывание доезжает до соседней бирки, новое касание его не перебивает.
      if (event.touches.length !== 1 || landing.current) {
        axis = 'none'
        return
      }
      const touch = event.touches[0]!
      start = { x: touch.clientX, y: touch.clientY, at: event.timeStamp }
      samples = [start]
      axis = 'pending'
    }

    const onTouchMove = (event: TouchEvent) => {
      if (axis === 'none') return
      if (event.touches.length !== 1) {
        // Второй палец — щипок: свайп отменяется, фото возвращается.
        if (axis === 'x') slideTo(0, stopSwiping)
        if (axis === 'down') release()
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
        if (axis === 'x') {
          // Палец подхватывает фото с того места, где оно сейчас (даже если оно ещё возвращалось).
          const now = moving ? Number.parseFloat(getComputedStyle(card).getPropertyValue(SWIPE_VAR)) || 0 : 0
          moving?.cancel()
          moving = null
          start = { ...start, x: start.x - now }
          card.classList.add(SWIPING_CLASS)
        }
      }
      // Палец ведёт фото, а не экран.
      if (event.cancelable) event.preventDefault()
      samples.push({ x: touch.clientX, y: touch.clientY, at: event.timeStamp })
      samples = samples.filter((sample) => event.timeStamp - sample.at <= VELOCITY_WINDOW_MS * 2)
      if (axis === 'x') {
        const shift = touch.clientX - start.x
        const hasTarget = shift > 0 ? actions.current.onPrevious : actions.current.onNext
        setOffset(hasTarget ? shift : shift * EDGE_RESISTANCE)
      } else {
        pull(Math.max(0, dy) * DOWN_FOLLOW)
      }
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length > 0) return
      const current = axis
      axis = 'none'
      if (current === 'none' || current === 'pending') return
      lastSwipeAt = event.timeStamp
      const speed = velocity()
      if (current === 'x') {
        const direction = Math.sign(offset)
        const go = direction > 0 ? actions.current.onPrevious : actions.current.onNext
        const far = Math.abs(offset) > card.clientWidth * COMMIT_DISTANCE
        const flick = Math.sign(speed.x) === direction && Math.abs(speed.x) > COMMIT_VELOCITY
        const thrownBack = Math.sign(speed.x) === -direction && Math.abs(speed.x) > COMMIT_VELOCITY
        if (go && direction !== 0 && (flick || (far && !thrownBack))) {
          // Фото доезжает, соседняя бирка встаёт на его место — и только тогда бирка сменяется.
          const gap = Number.parseFloat(getComputedStyle(card).getPropertyValue(PAGE_GAP_VAR)) || 0
          slideTo(direction * (card.clientWidth + gap), (animation) => {
            // Доехавший сдвиг держит анимация, пока бирка не сменится (`land`); следующий свайп — с нуля.
            offset = 0
            landing.current = animation
            go()
          })
        } else {
          slideTo(0, stopSwiping)
        }
      } else {
        const dy = (samples[samples.length - 1]?.y ?? start.y) - start.y
        const far = dy > card.clientHeight * COMMIT_DISTANCE || speed.y > COMMIT_VELOCITY
        if (far && speed.y > -COMMIT_VELOCITY) {
          // Переход к сетке анимирует слой сам (`transform`): сдвиг пальца снимаем до него.
          unpull()
          actions.current.onDown()
        } else {
          release()
        }
      }
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
      moving?.cancel()
      unpull()
      card.removeEventListener('touchstart', onTouchStart)
      card.removeEventListener('touchmove', onTouchMove)
      card.removeEventListener('touchend', onTouchEnd)
      card.removeEventListener('touchcancel', onTouchEnd)
      card.removeEventListener('click', onClick, { capture: true })
    }
  }, [cardRef, stageRef, enabled])

  /** Открытая бирка сменилась: снять доехавший сдвиг; `true` — её сменил свайп, фото уже на месте. */
  const land = useCallback(() => {
    const card = cardRef.current
    const swiped = landing.current !== null || Boolean(card?.classList.contains(SWIPING_CLASS))
    landing.current?.cancel()
    landing.current = null
    card?.classList.remove(SWIPING_CLASS)
    card?.style.removeProperty(SWIPE_VAR)
    return swiped
  }, [cardRef])

  return { land }
}
