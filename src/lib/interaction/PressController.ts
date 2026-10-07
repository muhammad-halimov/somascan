/**
 * Контроллер нажатий: следит за указателем на уровне документа и переводит касания
 * в состояния отклика (`PressFeedback`) по правилам нативных платформ.
 *
 * - Отклик появляется не сразу, а через `showDelayMs`, когда ясно, что это не прокрутка
 *   (UIScrollView.delaysContentTouches, ViewConfiguration.getTapTimeout). Если палец отпущен
 *   раньше, отклик всё равно показывается коротко.
 * - Сдвиг пальца больше `slopPx` (начало прокрутки) отменяет нажатие без отклика.
 * - Пока палец на экране, отклик держится сколько угодно — долгое нажатие подсвечено,
 *   как у нативной кнопки.
 * - Отклик гарантированно снимается: `pointerup`/`pointercancel`, `touchend`/`touchcancel`
 *   (запасной путь), прокрутка любого контейнера, уход окна из фокуса или в фон,
 *   а также по страховочному таймеру, если ни одно событие так и не пришло.
 */
import type { PressFeedback } from './PressFeedback'
import { isDisabledPressable, PRESSABLE_SELECTOR, type PressPoint } from './pressables'

/** Настройки контроллера. */
export interface PressControllerOptions {
  /** Задержка перед показом отклика, мс. */
  showDelayMs: number
  /** Сдвиг пальца, после которого касание считается прокруткой, px. */
  slopPx: number
}

/** Значения по умолчанию: между iOS (150 мс) и Android (100 мс), сдвиг ~8 dp. */
export const DEFAULT_PRESS_OPTIONS: PressControllerOptions = { showDelayMs: 90, slopPx: 10 }

/** Если за это время не пришло ни отпускания, ни отмены — считаем касание потерянным. */
const LOST_TOUCH_MS = 10_000

export class PressController {
  private pressable: HTMLElement | null = null
  private pointerId = -1
  private start: PressPoint = { x: 0, y: 0 }
  private shown = false
  private showTimer = 0
  private lostTimer = 0
  private readonly controller = new AbortController()
  private readonly feedback: PressFeedback
  private readonly options: PressControllerOptions

  constructor(feedback: PressFeedback, options: PressControllerOptions = DEFAULT_PRESS_OPTIONS) {
    this.feedback = feedback
    this.options = options
  }

  /** Подписывается на события документа. Повторный вызов без `detach` не нужен. */
  attach() {
    const { signal } = this.controller
    const passive = { passive: true, signal } as const
    document.addEventListener('pointerdown', this.onPointerDown, passive)
    document.addEventListener('pointermove', this.onPointerMove, passive)
    document.addEventListener('pointerup', this.onPointerUp, passive)
    document.addEventListener('pointercancel', this.onPointerCancel, passive)
    // Запасной путь: если pointer-события потеряны, касание всё равно завершится,
    // но только когда с экрана убран последний палец — второй палец не должен снимать отклик.
    document.addEventListener('touchend', this.onTouchEnd, passive)
    document.addEventListener('touchcancel', this.cancel, passive)
    // Прокрутка любого контейнера — это уже не нажатие.
    document.addEventListener('scroll', this.cancel, { passive: true, capture: true, signal })
    window.addEventListener('blur', this.cancel, { signal })
    window.addEventListener('pagehide', this.cancel, { signal })
    document.addEventListener('visibilitychange', this.onVisibilityChange, { signal })
  }

  /** Снимает подписки и убирает текущий отклик. */
  detach() {
    this.cancel()
    this.controller.abort()
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    // Только основной указатель и основная кнопка мыши: второй палец или правая кнопка — не нажатие.
    if (!event.isPrimary || event.button !== 0) return
    this.cancel()
    const pressable = (event.target as Element | null)?.closest<HTMLElement>(PRESSABLE_SELECTOR)
    if (!pressable || isDisabledPressable(pressable)) return
    this.pressable = pressable
    this.pointerId = event.pointerId
    this.start = { x: event.clientX, y: event.clientY }
    this.showTimer = window.setTimeout(this.show, this.options.showDelayMs)
    this.lostTimer = window.setTimeout(this.cancel, LOST_TOUCH_MS)
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return
    if (Math.hypot(event.clientX - this.start.x, event.clientY - this.start.y) > this.options.slopPx) this.cancel()
  }

  private readonly onPointerUp = (event: PointerEvent) => {
    if (event.pointerId === this.pointerId) this.finish()
  }

  private readonly onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId === this.pointerId) this.cancel()
  }

  private readonly onTouchEnd = (event: TouchEvent) => {
    if (event.touches.length === 0) this.finish()
  }

  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') this.cancel()
  }

  /** Показывает отклик (задержка истекла или палец уже отпущен). */
  private readonly show = () => {
    if (!this.pressable || this.shown) return
    window.clearTimeout(this.showTimer)
    this.shown = true
    this.feedback.begin(this.pressable, this.start)
  }

  /** Палец отпущен над элементом: короткое нажатие тоже получает отклик. */
  private readonly finish = () => {
    if (!this.pressable) return
    if (!this.shown) this.show()
    this.feedback.end()
    this.reset()
  }

  /** Нажатие отменено: отклик, если был, снимается сразу. */
  private readonly cancel = () => {
    if (!this.pressable) return
    if (this.shown) this.feedback.cancel()
    this.reset()
  }

  private reset() {
    window.clearTimeout(this.showTimer)
    window.clearTimeout(this.lostTimer)
    this.pressable = null
    this.pointerId = -1
    this.shown = false
  }
}
