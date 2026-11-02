import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { flushSync } from 'react-dom'
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

/**
 * Пока палец не ушёл дальше этого, px, направление свайпа ещё уточняется: первые пиксели касания шумят — большой
 * палец идёт дугой, и свайп вниз часто начинается вкось (читался бы как свайп вбок и не открывал сетку).
 */
const AXIS_SETTLE_DISTANCE = 4 * TOUCH_SLOP

/** Экран прокручен к началу — с допуском на дробную прокрутку, px. */
const SCROLL_TOP_TOLERANCE = 1

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

/** Карточка без сдвига вбок: соседние бирки скрыты, фото на месте. */
function clearSwipe(card: HTMLElement | null) {
  card?.classList.remove(SWIPING_CLASS)
  card?.style.removeProperty(SWIPE_VAR)
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
 * место, и бирка сменяется (`land` — без своего слайда); иначе фото плавно возвращается. Касание, пока фото ещё
 * доезжает, довершает перелистывание сразу — листать можно быстро, подряд, ни один свайп не теряется.
 * Вниз — фото тянется за пальцем и чуть уменьшается; дальше порога — сетка, как по кнопке, и фото уходит в неё
 * с того места, куда его дотянули. Только когда экран прокручен к началу, иначе это прокрутка.
 * Жест, который может оказаться свайпом, браузер не забирает себе (своя прокрутка и оттяжка края) с первого сдвига;
 * направление уточняется на первых `AXIS_SETTLE_DISTANCE`. Второй палец (щипок) и прокрутка свайпом не считаются;
 * клик сразу после свайпа гасится: конец свайпа не нажимает ни фото, ни кнопки карточки.
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
    /** Экран прокручен к началу: тянуть вниз — к сетке, а не прокрутка. */
    let atTop = true
    /** Где палец подхватил фото (оно ещё возвращалось на место): сдвиг вбок и оттяжка вниз, px. */
    let caught = { x: 0, y: 0 }
    /** Сдвиг вбок, который ещё едет; `committing` — это доезд до соседней бирки, а не возврат на место. */
    let moving: Animation | null = null
    let committing = false
    /** Недотянутое вниз фото, которое ещё возвращается на место. */
    let returning: Animation | null = null

    const setOffset = (px: number) => {
      offset = px
      card.style.setProperty(SWIPE_VAR, `${px}px`)
    }
    const stopSwiping = () => {
      clearSwipe(card)
      offset = 0
    }
    /** Сдвиг плавно доезжает до `to` (держится там, пока его не снимут); по окончании — `done`. */
    const slideTo = (to: number, done: (animation: Animation | null) => void, commit = false) => {
      moving?.cancel()
      const from = offset
      setOffset(to)
      if (prefersReducedMotion()) return done(null)
      const animation = card.animate([{ [SWIPE_VAR]: `${from}px` }, { [SWIPE_VAR]: `${to}px` }], { ...motionTiming(PAGE_MS), fill: 'forwards' })
      moving = animation
      committing = commit
      animation.finished.then(() => {
        if (moving !== animation) return
        moving = null
        committing = false
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
    /** Оттяжка вниз плавно сходит на нет — за `timing` (по умолчанию — возврат недотянутого фото). */
    const release = (timing = motionTiming(PAGE_MS)) => {
      const from = { translate: stage.style.translate || '0px 0px', scale: stage.style.scale || '1' }
      unpull()
      if (!prefersReducedMotion()) returning = stage.animate([from, { translate: '0px 0px', scale: '1' }], timing)
    }

    /** Направление по сдвигу пальца от начала касания. */
    const axisOf = (dx: number, dy: number): Exclude<Axis, 'pending'> => (Math.abs(dx) > Math.abs(dy) ? 'x' : dy > 0 && atTop ? 'down' : 'none')
    /** Палец ведёт фото в направлении `next`: вбок или вниз (направление могло уточниться — прежнее снимается). */
    const follow = (next: 'x' | 'down') => {
      if (next === 'x') {
        unpull()
        // Фото ещё возвращалось — палец подхватывает его там, где оно сейчас.
        caught = { ...caught, x: moving ? Number.parseFloat(getComputedStyle(card).getPropertyValue(SWIPE_VAR)) || 0 : 0 }
        moving?.cancel()
        moving = null
        card.classList.add(SWIPING_CLASS)
      } else {
        if (axis === 'x') stopSwiping()
        caught = { ...caught, y: returning ? Number.parseFloat(getComputedStyle(stage).translate.split(' ')[1] ?? '') || 0 : 0 }
        returning?.cancel()
        returning = null
      }
      axis = next
    }
    /** Жест — не свайп (второй палец, система забрала касание): фото возвращается на место. */
    const abandon = () => {
      if (axis === 'x') slideTo(0, stopSwiping)
      if (axis === 'down') release()
      axis = 'none'
    }

    /** Скорость пальца по последним `VELOCITY_WINDOW_MS`. */
    const velocity = () => {
      const last = samples[samples.length - 1]
      const first = last && samples.find((sample) => last.at - sample.at <= VELOCITY_WINDOW_MS)
      if (!last || !first || last.at === first.at) return { x: 0, y: 0 }
      return { x: (last.x - first.x) / (last.at - first.at), y: (last.y - first.y) / (last.at - first.at) }
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return abandon()
      // Перелистывание ещё доезжает — касание довершает его сразу (бирка сменится до следующего события).
      if (moving && committing) moving.finish()
      const touch = event.touches[0]!
      start = { x: touch.clientX, y: touch.clientY, at: event.timeStamp }
      samples = [start]
      caught = { x: 0, y: 0 }
      atTop = (scrollParentOf(card)?.scrollTop ?? 0) < SCROLL_TOP_TOLERANCE
      axis = 'pending'
    }

    const onTouchMove = (event: TouchEvent) => {
      if (axis === 'none') return
      if (event.touches.length !== 1) return abandon()
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
        if (next !== 'none' && next !== axis) follow(next)
      }
      // Палец ведёт фото, а не экран.
      if (event.cancelable) event.preventDefault()
      samples.push({ x: touch.clientX, y: touch.clientY, at: event.timeStamp })
      samples = samples.filter((sample) => event.timeStamp - sample.at <= VELOCITY_WINDOW_MS * 2)
      if (axis === 'x') {
        const shift = caught.x + dx
        const hasTarget = shift > 0 ? actions.current.onPrevious : actions.current.onNext
        setOffset(hasTarget ? shift : shift * EDGE_RESISTANCE)
      } else {
        pull(Math.max(0, caught.y + dy * DOWN_FOLLOW))
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
          // Фото доезжает, соседняя бирка встаёт на его место — и бирка сменяется.
          const gap = Number.parseFloat(getComputedStyle(card).getPropertyValue(PAGE_GAP_VAR)) || 0
          slideTo(direction * (card.clientWidth + gap), (animation) => {
            // Доехавший сдвиг держит анимация, пока бирка не сменится (`land`); следующий свайп — с нуля.
            offset = 0
            landing.current = animation
            // Сразу в DOM: следующее касание и кадр — уже с новой биркой и её соседями.
            flushSync(go)
            // Бирка не сменилась — сдвиг снимается здесь, иначе фото так и стояло бы за краем.
            if (card.classList.contains(SWIPING_CLASS)) {
              landing.current?.cancel()
              landing.current = null
              stopSwiping()
            }
          }, true)
        } else {
          slideTo(0, stopSwiping)
        }
      } else {
        const dy = (samples[samples.length - 1]?.y ?? start.y) - start.y
        const far = dy > card.clientHeight * COMMIT_DISTANCE || speed.y > COMMIT_VELOCITY
        if (far && speed.y > -COMMIT_VELOCITY) {
          // К сетке — с того места, куда фото дотянули: оттяжка сходит на нет вместе с переходом (тем же временем
          // и кривой), без скачка на место перед ним.
          release(motionTiming())
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
    card.addEventListener('touchcancel', abandon)
    card.addEventListener('click', onClick, { capture: true })
    return () => {
      // Возврат оттяжки не снимаем: после свайпа вниз он идёт вместе с переходом к сетке.
      moving?.cancel()
      unpull()
      card.removeEventListener('touchstart', onTouchStart)
      card.removeEventListener('touchmove', onTouchMove)
      card.removeEventListener('touchend', onTouchEnd)
      card.removeEventListener('touchcancel', abandon)
      card.removeEventListener('click', onClick, { capture: true })
    }
  }, [cardRef, stageRef, enabled])

  /** Открытая бирка сменилась: снять доехавший сдвиг; `true` — её сменил свайп, фото уже на месте. */
  const land = useCallback(() => {
    const card = cardRef.current
    const swiped = landing.current !== null || Boolean(card?.classList.contains(SWIPING_CLASS))
    landing.current?.cancel()
    landing.current = null
    clearSwipe(card)
    return swiped
  }, [cardRef])

  return { land }
}
