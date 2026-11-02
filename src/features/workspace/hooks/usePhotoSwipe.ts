import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { TAP_GUARD_MS, TOUCH_SLOP } from '@/lib/interaction/gestures'
import { scrollParentOf } from '@/lib/interaction/scrollParent'
import { prefersReducedMotion, settleTiming } from '../utils/motion'

/** Свайп вбок длиннее этой доли ширины карточки — переход к соседней бирке. */
const COMMIT_DISTANCE = 0.2

/** Или быстрый взмах в ту же сторону: скорость пальца, px/мс. */
const COMMIT_VELOCITY = 0.3

/** Скорость пальца — по последним столько мс движения: по одному шагу она скачет. */
const VELOCITY_WINDOW_MS = 80

/** Соседней бирки нет — фото тянется за пальцем с сопротивлением, во столько раз слабее. */
const EDGE_RESISTANCE = 0.3

/**
 * Пока палец не ушёл дальше этого, px, направление свайпа ещё уточняется: первые пиксели касания шумят — большой
 * палец идёт дугой, и свайп вниз часто начинается вкось (читался бы как свайп вбок и не открывал сетку).
 */
const AXIS_SETTLE_DISTANCE = 4 * TOUCH_SLOP

/** Свайп вниз открывает сетку, если палец прошёл столько, px, или взмахнул вниз (`COMMIT_VELOCITY`). */
const DOWN_DISTANCE = AXIS_SETTLE_DISTANCE

/** Экран прокручен к началу — с допуском на дробную прокрутку, px. */
const SCROLL_TOP_TOLERANCE = 1

/** Класс карточки, пока фото листают вбок: соседние бирки видны (PhotoCard.css). */
const SWIPING_CLASS = 'is-swiping'

/** Слои, которые едут при свайпе вбок: фото (и то, что на нём: заглушки, спиннер) и соседние бирки; кнопки стоят. */
const SLIDING_LAYERS = '.photo-stage > :is(.photo-image-action, .photo-empty, .photo-manual, .photo-loading), .photo-pager'

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

/** Доехавшее перелистывание: слои стоят на месте соседней бирки, пока бирка не сменится. */
interface Landing {
  layers: HTMLElement[]
  animations: Animation[]
}

/** Сдвиг слоёв вбок, px. */
function shiftLayers(layers: readonly HTMLElement[], px: number) {
  for (const layer of layers) layer.style.translate = `${px}px 0`
}

/** Палец ведёт слои: каждый — своим слоем композитора (сдвиг без перерисовки). */
function startSwipe(card: HTMLElement, layers: readonly HTMLElement[]) {
  card.classList.add(SWIPING_CLASS)
  for (const layer of layers) layer.style.willChange = 'translate'
}

/** Карточка без сдвига вбок: соседние бирки скрыты, слои на месте. */
function clearSwipe(card: HTMLElement | null, layers: readonly HTMLElement[]) {
  card?.classList.remove(SWIPING_CLASS)
  for (const layer of layers) {
    layer.style.translate = ''
    layer.style.willChange = ''
  }
}

/** Параметры `usePhotoSwipe`. */
export interface PhotoSwipeOptions {
  /** Карточка фото: на ней ловим касания. */
  cardRef: RefObject<HTMLElement | null>
  /** Свайпы разрешены (одна бирка, фото не увеличено: тогда палец двигает фото). */
  enabled: boolean
  /** Свайп вправо — предыдущая бирка (нет — фото только тянется и возвращается). */
  onPrevious?: () => void
  /** Свайп влево — следующая бирка. */
  onNext?: () => void
  /** Свайп вниз — сетка: то же, что кнопка «Сетка». */
  onDown: () => void
}

/**
 * Свайпы по карточке фото одной бирки: влево и вправо — к соседней бирке, сверху вниз — к сетке.
 *
 * Вбок — как галерея: фото едет за пальцем, соседняя бирка (`PhotoPeek`) въезжает рядом, без пустого места; кнопки
 * поверх фото стоят. Слои двигает `translate` (композитор, без пересчёта стилей карточки на каждый кадр).
 * Отпустили дальше `COMMIT_DISTANCE` или взмахом — фото доезжает с той скоростью, с какой его вёл палец, соседняя
 * бирка встаёт на его место, и бирка сменяется (`land` — без своего слайда); иначе фото так же плавно возвращается.
 * Касание, пока фото ещё доезжает, довершает перелистывание сразу — листать можно быстро, подряд.
 * Вниз — сетка, как по кнопке «Сетка»: тот же переход, фото за пальцем не тянется. Только когда экран прокручен
 * к началу, иначе это прокрутка.
 * Жест, который может оказаться свайпом, браузер не забирает себе (своя прокрутка и оттяжка края) с первого сдвига;
 * направление уточняется на первых `AXIS_SETTLE_DISTANCE`. Второй палец (щипок) и прокрутка свайпом не считаются;
 * клик сразу после свайпа гасится: конец свайпа не нажимает ни фото, ни кнопки карточки.
 * @returns `land()` — вызвать, когда открытая бирка сменилась: снимает доехавший сдвиг до кадра; `true` — бирку
 * сменил свайп, и её фото уже на месте (свой слайд не нужен).
 */
export function usePhotoSwipe({ cardRef, enabled, onPrevious, onNext, onDown }: PhotoSwipeOptions) {
  const actions = useRef({ onPrevious, onNext, onDown })
  useLayoutEffect(() => {
    actions.current = { onPrevious, onNext, onDown }
  })
  const landing = useRef<Landing | null>(null)

  useEffect(() => {
    const card = cardRef.current
    if (!card || !enabled) return
    let axis: Axis = 'none'
    let start: Sample = { x: 0, y: 0, at: 0 }
    let samples: Sample[] = []
    let lastSwipeAt = -Infinity
    /** Экран прокручен к началу: свайп вниз — к сетке, а не прокрутка. */
    let atTop = true
    /** Слои, которые ведёт палец, и их сдвиг, px. */
    let layers: HTMLElement[] = []
    let offset = 0
    /** Где палец подхватил фото (оно ещё возвращалось на место), px. */
    let caught = 0
    /** Сдвиг, который ещё едет. */
    let moving: Animation[] = []
    /** Идёт доезд до соседней бирки: довершить его сразу (бирка сменится тут же); `null` — не идёт. */
    let finishCommit: (() => void) | null = null

    const setOffset = (px: number) => {
      offset = px
      shiftLayers(layers, px)
    }
    const stopSwiping = () => {
      clearSwipe(card, layers)
      offset = 0
    }
    const stopMoving = () => {
      moving.forEach((animation) => animation.cancel())
      moving = []
      finishCommit = null
    }
    /** Сдвиг сейчас, px (и посреди анимации). */
    const currentOffset = () => (layers[0] ? Number.parseFloat(getComputedStyle(layers[0]).translate) || 0 : 0)
    /**
     * Сдвиг доезжает до `to` (и держится там, пока его не снимут); по окончании — `done`. `speedX` — скорость пальца
     * вбок, px/мс: фото отрывается от пальца с его скоростью и плавно останавливается (`settleTiming`).
     */
    const slideTo = (to: number, speedX: number, done: (animations: Animation[]) => void, commit = false) => {
      stopMoving()
      const from = offset
      setOffset(to)
      if (prefersReducedMotion() || from === to) return done([])
      const timing: KeyframeAnimationOptions = { ...settleTiming(to - from, speedX * Math.sign(to - from)), fill: 'forwards' }
      const animations = layers.map((layer) => layer.animate([{ translate: `${from}px 0` }, { translate: `${to}px 0` }], timing))
      moving = animations
      const settle = () => {
        if (moving !== animations) return
        moving = []
        finishCommit = null
        done(animations)
      }
      // Довершается синхронно, не по `finished`: обещание после `finish()` разрешается только к следующему кадру,
      // и первый сдвиг нового касания успевал бы отменить перелистывание.
      if (commit) finishCommit = () => {
        animations.forEach((animation) => animation.finish())
        settle()
      }
      void Promise.all(animations.map((animation) => animation.finished)).then(settle, () => {})
    }

    /** Направление по сдвигу пальца от начала касания. */
    const axisOf = (dx: number, dy: number): Exclude<Axis, 'pending'> => (Math.abs(dx) > Math.abs(dy) ? 'x' : dy > 0 && atTop ? 'down' : 'none')
    /** Палец ведёт жест в направлении `next`: вбок или вниз (направление могло уточниться — прежнее снимается). */
    const follow = (next: 'x' | 'down') => {
      if (next === 'x') {
        layers = Array.from(card.querySelectorAll<HTMLElement>(SLIDING_LAYERS))
        // Фото ещё возвращалось — палец подхватывает его там, где оно сейчас.
        caught = moving.length > 0 ? currentOffset() : 0
        stopMoving()
        startSwipe(card, layers)
      } else if (axis === 'x') {
        stopSwiping()
      }
      axis = next
    }
    /** Жест — не свайп (второй палец, система забрала касание): фото возвращается на место. */
    const abandon = () => {
      if (axis === 'x') slideTo(0, 0, stopSwiping)
      axis = 'none'
    }

    /**
     * Узел, которого коснулся палец: браузер шлёт ему всё касание до конца — даже если бирка сменилась (касание
     * довершило перелистывание) и узла уже нет в DOM; тогда до карточки события не всплывают. Поэтому движение
     * и отпускание слушаем на нём.
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
    const onTouchCancel = () => {
      untrack()
      abandon()
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
      // Перелистывание ещё доезжает — касание довершает его сразу: следующий свайп — уже от новой бирки.
      finishCommit?.()
      track(event.target)
      const touch = event.touches[0]!
      start = { x: touch.clientX, y: touch.clientY, at: event.timeStamp }
      samples = [start]
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
        const shift = caught + dx
        const hasTarget = shift > 0 ? actions.current.onPrevious : actions.current.onNext
        setOffset(hasTarget ? shift : shift * EDGE_RESISTANCE)
      }
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length > 0) return
      untrack()
      const current = axis
      axis = 'none'
      if (current === 'none' || current === 'pending') return
      lastSwipeAt = event.timeStamp
      const speed = velocity()
      if (current === 'down') {
        // Как по кнопке «Сетка»: тот же переход. Взмах вверх в конце — передумали.
        const dy = (samples[samples.length - 1]?.y ?? start.y) - start.y
        if ((dy > DOWN_DISTANCE || speed.y > COMMIT_VELOCITY) && speed.y > -COMMIT_VELOCITY) actions.current.onDown()
        return
      }
      const direction = Math.sign(offset)
      const go = direction > 0 ? actions.current.onPrevious : actions.current.onNext
      const far = Math.abs(offset) > card.clientWidth * COMMIT_DISTANCE
      const flick = Math.sign(speed.x) === direction && Math.abs(speed.x) > COMMIT_VELOCITY
      const thrownBack = Math.sign(speed.x) === -direction && Math.abs(speed.x) > COMMIT_VELOCITY
      if (!go || direction === 0 || !(flick || (far && !thrownBack))) {
        slideTo(0, speed.x, stopSwiping)
        return
      }
      // Фото доезжает, соседняя бирка встаёт на его место — и бирка сменяется.
      const gap = Number.parseFloat(getComputedStyle(card).getPropertyValue(PAGE_GAP_VAR)) || 0
      const gestureLayers = layers
      slideTo(direction * (card.clientWidth + gap), speed.x, (animations) => {
        // Доехавший сдвиг держат анимации, пока бирка не сменится (`land`); следующий свайп — с нуля.
        offset = 0
        layers = []
        landing.current = { layers: gestureLayers, animations }
        // Сразу в DOM: следующее касание и кадр — уже с новой биркой и её соседями.
        flushSync(go)
        // Бирка не сменилась — сдвиг снимается здесь, иначе фото так и стояло бы за краем.
        if (landing.current) {
          landing.current.animations.forEach((animation) => animation.cancel())
          landing.current = null
          clearSwipe(card, gestureLayers)
        }
      }, true)
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
      stopMoving()
      stopSwiping()
      card.removeEventListener('touchstart', onTouchStart)
      card.removeEventListener('click', onClick, { capture: true })
    }
  }, [cardRef, enabled])

  /** Открытая бирка сменилась: снять доехавший сдвиг; `true` — её сменил свайп, фото уже на месте. */
  const land = useCallback(() => {
    const card = cardRef.current
    const current = landing.current
    const swiped = current !== null || Boolean(card?.classList.contains(SWIPING_CLASS))
    landing.current = null
    current?.animations.forEach((animation) => animation.cancel())
    clearSwipe(card, current?.layers ?? [])
    return swiped
  }, [cardRef])

  return { land }
}
