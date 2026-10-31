import { useCallback, useRef, useState, type PointerEvent, type TouchEvent } from 'react'
import { PhotoGeometry, touchCenter, touchDistance, type Point, type Size } from '../utils/PhotoGeometry'

/** Начало щипка: расстояние и центр между пальцами, масштаб и сдвиг в этот момент. */
interface PinchStart {
  /** Расстояние между пальцами. */
  distance: number
  /** Центр щипка относительно центра рамки. */
  center: Point
  /** Масштаб в начале. */
  scale: number
  /** Сдвиг в начале. */
  offset: Point
}

/** Начало перетаскивания: позиция указателя и сдвиг в этот момент. */
interface PanStart {
  /** Id указателя мыши; у касаний отсутствует. */
  pointerId?: number
  /** Позиция указателя (экранные координаты). */
  position: Point
  /** Сдвиг в начале. */
  offset: Point
}

/**
 * Исходный вид фото в рамке: `contain` — целиком (по краям могут быть полосы), `cover` — заполняет рамку
 * без полос, лишнее уходит за края (отдалить можно до вида целиком). Только вид: распознавание получает исходное фото.
 */
export type PhotoFit = 'contain' | 'cover'

/** Без сдвига. */
const NO_OFFSET: Point = { x: 0, y: 0 }

/** Размер рамки до первого замера (совпадает с размером карточки в CSS). */
const INITIAL_FRAME: Size = { width: 380, height: 352 }

/** Движение пальца меньше этого (px) — ещё касание, а не перетаскивание. */
const TAP_SLOP = 6

/** Столько миллисекунд после жеста нажатие на фото не считается тапом. */
const TAP_GUARD_MS = 350

/** Увеличение больше исходного вида на эту долю — уже «увеличено» (дробные погрешности щипка не в счёт). */
const ZOOM_EPSILON = 0.01

/** Параметры `usePhotoTransform`. */
export interface PhotoTransformOptions {
  /** Натуральный размер фото или `null`, пока оно грузится. */
  naturalSize: Size | null
  /** Разрешены ли жесты (фото показано и загружено). */
  enabled: boolean
  /** Исходный вид (по умолчанию `contain`). */
  fit?: PhotoFit
  /**
   * Поворот, которым владеет бирка (он же уходит на распознавание): кнопка поворота и «Сброс» меняют его
   * через `onRotationChange`. Без него поворот — своё состояние просмотра.
   */
  rotation?: number
  /** Новый поворот бирки (по часовой стрелке, 0–270). */
  onRotationChange?: (rotation: number) => void
}

/**
 * Масштаб, сдвиг и поворот фото.
 *
 * Масштаб считается от исходного вида (`fit`): «увеличено» — крупнее исходного (тогда палец двигает фото),
 * «Меньше» отдаляет до фото целиком, увеличение — до `PhotoGeometry.MAX_SCALE` раз.
 * Касание: щипок двумя пальцами масштабирует относительно точки между пальцами
 * (и одновременно двигает фото), одним пальцем — перетаскивание увеличенного фото.
 * Мышь: перетаскивание. Двойное нажатие (`toggleZoomAt`): увеличение к точке нажатия, у увеличенного — исходный вид.
 * Кнопки: `zoomIn`, `zoomOut`, `rotate`, `reset`. Кнопки и двойное нажатие меняют вид плавно (`animated`),
 * жесты пальцами — сразу, без задержки.
 * Поворот может принадлежать бирке (`rotation` и `onRotationChange`) — тогда он сохраняется между бирками
 * и в сетке, а не только в этом просмотре.
 * Сдвиг всегда ограничен так, чтобы фото не уезжало за края рамки, но до любого
 * края увеличенного фото можно дотянуться.
 */
export function usePhotoTransform({ naturalSize, enabled, fit = 'contain', rotation: ownedRotation, onRotationChange }: PhotoTransformOptions) {
  /** Увеличение относительно исходного вида (1 — исходный). */
  const [zoom, setZoom] = useState(1)
  const [viewRotation, setViewRotation] = useState(0)
  const rotation = ownedRotation ?? viewRotation
  const setRotation = (next: number) => (onRotationChange ? onRotationChange(next) : setViewRotation(next))
  const [offset, setOffset] = useState<Point>(NO_OFFSET)
  const [frameSize, setFrameSize] = useState<Size>(INITIAL_FRAME)
  /** Последнее изменение — кнопкой или двойным нажатием: показывается плавно. */
  const [animated, setAnimated] = useState(false)
  const frameElement = useRef<HTMLElement | null>(null)
  const pinchStart = useRef<PinchStart | null>(null)
  const panStart = useRef<PanStart | null>(null)
  /** Время (`event.timeStamp`) последнего движения пальцем или мышью: защищает от ложного «тапа» после жеста. */
  const lastMoveAt = useRef(0)

  const geometry = new PhotoGeometry(naturalSize, frameSize)
  /** Масштаб исходного вида при текущем повороте. */
  const baseScale = (forRotation = rotation) => (fit === 'cover' ? geometry.coverScale(forRotation) : PhotoGeometry.MIN_SCALE)
  const base = baseScale()
  const scale = base * zoom
  const isZoomed = zoom > 1 + ZOOM_EPSILON

  /** Масштаб в допустимых границах: от фото целиком до `MAX_SCALE` раз крупнее исходного вида. */
  const clampScale = (next: number) => Math.min(base * PhotoGeometry.MAX_SCALE, Math.max(PhotoGeometry.MIN_SCALE, next))

  /** Сдвиг в допустимых границах для заданных масштаба и поворота (по умолчанию текущих). */
  const clamp = (next: Point, nextScale = scale, nextRotation = rotation) => geometry.clampOffset(next, nextScale, nextRotation)

  /** Точка экрана относительно центра рамки. */
  const fromFrameCenter = (point: Point): Point => {
    const rect = frameElement.current?.getBoundingClientRect()
    if (!rect) return NO_OFFSET
    return { x: point.x - (rect.left + rect.width / 2), y: point.y - (rect.top + rect.height / 2) }
  }

  /** Новый масштаб и сдвиг, который сохраняет точку `focus` (от центра рамки) на месте. */
  const scaleAround = (nextScale: number, focus: Point) => {
    const clamped = clampScale(nextScale)
    setZoom(clamped / base)
    setOffset(clamp(PhotoGeometry.zoomOffset(offset, scale, clamped, focus), clamped))
  }

  /**
   * Callback-ref для элемента-рамки: измеряет его сейчас и при каждом изменении размера
   * (поворот экрана, полноэкранный просмотр). React 19 вызывает возвращённую очистку при размонтировании.
   */
  const attachFrame = useCallback((element: HTMLElement | null) => {
    frameElement.current = element
    if (!element) return
    const measure = () => setFrameSize({ width: element.clientWidth, height: element.clientHeight })
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => {
      observer.disconnect()
      if (frameElement.current === element) frameElement.current = null
    }
  }, [])

  /** Масштаб кнопками: относительно центра рамки, плавно. */
  const zoomBy = (step: number) => {
    setAnimated(true)
    scaleAround(scale + step * base, NO_OFFSET)
  }

  /**
   * Двойное нажатие: плавное увеличение так, чтобы точка фото под пальцем осталась на месте; у увеличенного фото —
   * исходный вид.
   * @param point Точка нажатия на экране.
   */
  const toggleZoomAt = (point: Point) => {
    if (!enabled) return
    setAnimated(true)
    if (isZoomed) {
      setZoom(1)
      setOffset(NO_OFFSET)
      return
    }
    scaleAround(base * PhotoGeometry.DOUBLE_TAP_SCALE, fromFrameCenter(point))
  }

  /** Поворот на четверть оборота по часовой стрелке, плавно; сдвиг остаётся в допустимых границах. */
  const rotate = () => {
    const next = PhotoGeometry.nextRotation(rotation)
    setAnimated(true)
    setRotation(next)
    setOffset(clamp(offset, baseScale(next) * zoom, next))
  }

  /** Исходный вид и сдвиг сразу, без анимации (другая бирка: её поворот — свой, его не трогаем). */
  const resetView = useCallback(() => {
    setAnimated(false)
    setZoom(1)
    setOffset(NO_OFFSET)
    setViewRotation(0)
  }, [])

  /** «Сброс»: исходный вид, сдвиг и поворот, плавно. */
  const reset = () => {
    resetView()
    setAnimated(true)
    setRotation(0)
  }

  /** Запоминает время движения, если оно больше порога касания. */
  const trackMove = (dx: number, dy: number, timeStamp: number) => {
    if (Math.abs(dx) + Math.abs(dy) > TAP_SLOP) lastMoveAt.current = timeStamp
  }

  /** Начинает щипок (два пальца) или перетаскивание (один палец по увеличенному фото); жест — без анимации. */
  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (!enabled) return
    const { touches } = event
    if (touches.length === 2) {
      setAnimated(false)
      pinchStart.current = {
        distance: touchDistance(touches[0], touches[1]),
        center: fromFrameCenter(touchCenter(touches[0], touches[1])),
        scale,
        offset,
      }
      panStart.current = null
    } else if (touches.length === 1 && isZoomed) {
      setAnimated(false)
      panStart.current = { position: { x: touches[0].clientX, y: touches[0].clientY }, offset }
    }
  }

  /** Применяет текущий щипок или перетаскивание. */
  const onTouchMove = (event: TouchEvent<HTMLElement>) => {
    const { touches } = event
    const pinch = pinchStart.current
    if (touches.length === 2 && pinch) {
      const nextScale = clampScale(pinch.scale * touchDistance(touches[0], touches[1]) / pinch.distance)
      const center = fromFrameCenter(touchCenter(touches[0], touches[1]))
      // Точка фото, бывшая под центром щипка, остаётся под пальцами: и масштаб, и сдвиг сразу.
      const ratio = nextScale / pinch.scale
      const next = { x: center.x - (pinch.center.x - pinch.offset.x) * ratio, y: center.y - (pinch.center.y - pinch.offset.y) * ratio }
      lastMoveAt.current = event.timeStamp
      setZoom(nextScale / base)
      setOffset(clamp(next, nextScale))
      return
    }
    const pan = panStart.current
    if (touches.length === 1 && pan) {
      const dx = touches[0].clientX - pan.position.x
      const dy = touches[0].clientY - pan.position.y
      trackMove(dx, dy, event.timeStamp)
      setOffset(clamp({ x: pan.offset.x + dx, y: pan.offset.y + dy }))
    }
  }

  /** Завершает жест; если после щипка остался один палец, продолжаем перетаскиванием. */
  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const { touches } = event
    if (touches.length < 2 && pinchStart.current) {
      pinchStart.current = null
      panStart.current = touches.length === 1 && isZoomed
        ? { position: { x: touches[0].clientX, y: touches[0].clientY }, offset }
        : null
    }
    if (touches.length === 0) panStart.current = null
  }

  /** Начинает перетаскивание мышью (касания обрабатываются touch-обработчиками). */
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || !enabled || !isZoomed) return
    setAnimated(false)
    event.currentTarget.setPointerCapture(event.pointerId)
    panStart.current = { pointerId: event.pointerId, position: { x: event.clientX, y: event.clientY }, offset }
  }

  /** Применяет перетаскивание мышью. */
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const pan = panStart.current
    if (!pan || pan.pointerId !== event.pointerId) return
    const dx = event.clientX - pan.position.x
    const dy = event.clientY - pan.position.y
    trackMove(dx, dy, event.timeStamp)
    setOffset(clamp({ x: pan.offset.x + dx, y: pan.offset.y + dy }))
  }

  /** Завершает перетаскивание мышью. */
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (panStart.current?.pointerId === event.pointerId) panStart.current = null
  }

  return {
    /** Callback-ref для элемента-рамки. */
    attachFrame,
    scale,
    rotation,
    offset,
    /** Размер блока фото до поворота (см. `PhotoGeometry.layout`). */
    layout: geometry.layout(rotation),
    isZoomed,
    /** Последнее изменение показывать плавно (кнопки, двойное нажатие), а не сразу (жесты). */
    animated,
    /** Исходный вид: без увеличения и отдаления, сдвига и поворота (сбрасывать нечего). */
    isPristine: Math.abs(zoom - 1) <= ZOOM_EPSILON && rotation === 0 && offset.x === 0 && offset.y === 0,
    canZoomIn: zoom < PhotoGeometry.MAX_SCALE,
    canZoomOut: scale > PhotoGeometry.MIN_SCALE + ZOOM_EPSILON,
    zoomIn: () => zoomBy(PhotoGeometry.SCALE_STEP),
    zoomOut: () => zoomBy(-PhotoGeometry.SCALE_STEP),
    toggleZoomAt,
    rotate,
    reset,
    resetView,
    /** `true`, если нажатие (`event.timeStamp`) случилось сразу после жеста: тогда это не «тап». */
    wasGesture: (timeStamp: number) => timeStamp - lastMoveAt.current < TAP_GUARD_MS,
    /** Обработчики касаний (щипок и перетаскивание одним пальцем). */
    touchHandlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
    /** Обработчики мыши (перетаскивание). */
    pointerHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  }
}

/** Значение, которое возвращает `usePhotoTransform`. */
export type PhotoTransform = ReturnType<typeof usePhotoTransform>
