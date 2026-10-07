/**
 * Визуальный отклик на нажатие — платформенные стратегии.
 *
 * Браузерные `:active`/`:hover` в WebView ненадёжны: состояние «залипает» после прокрутки,
 * долгого нажатия или системного жеста. Поэтому отклик ведёт код: `PressController`
 * решает, когда нажатие началось, завершилось или отменено, а стратегия только рисует.
 *
 * - iOS: подсветка атрибутом `data-pressed` (CSS: сегмент и кнопка приглушаются,
 *   строка списка заливается серым — как UISegmentedControl, UIButton и UITableViewCell).
 * - Android: волна Material 3 — круг, растущий от точки касания до краёв элемента
 *   и остающийся слоем состояния, пока палец на экране.
 */
import { resolveFeedbackHost, type PressPoint } from './pressables'

/** Стратегия отклика на нажатие. */
export abstract class PressFeedback {
  /** Нажатие подтверждено (это не начало прокрутки): показать отклик на элементе. */
  abstract begin(pressable: HTMLElement, point: PressPoint): void
  /** Палец отпущен над элементом: убрать отклик с анимацией отпускания. */
  abstract end(): void
  /** Нажатие отменено (прокрутка, системный жест, уход приложения в фон): убрать отклик. */
  abstract cancel(): void
}

/**
 * Подсветка атрибутом `data-pressed` на самом нажимаемом элементе (iOS). Внешний вид задаёт CSS
 * (`styles/native.css`): кнопка приглушается целиком, строка списка заливается серым.
 * Быстрое касание показывает подсветку не меньше `MIN_VISIBLE_MS`: так UIKit подсвечивает
 * ячейку даже при мгновенном тапе.
 */
export class HighlightFeedback extends PressFeedback {
  private static readonly MIN_VISIBLE_MS = 70

  private target: HTMLElement | null = null
  private shownAt = 0

  begin(pressable: HTMLElement) {
    this.release()
    this.target = pressable
    this.target.setAttribute('data-pressed', '')
    this.shownAt = performance.now()
  }

  end() {
    const target = this.target
    if (!target) return
    this.target = null
    const wait = Math.max(0, HighlightFeedback.MIN_VISIBLE_MS - (performance.now() - this.shownAt))
    window.setTimeout(() => target.removeAttribute('data-pressed'), wait)
  }

  cancel() {
    this.release()
  }

  private release() {
    this.target?.removeAttribute('data-pressed')
    this.target = null
  }
}

/** Волна, которая сейчас рисуется. */
interface Ripple {
  element: HTMLElement
  startedAt: number
}

/**
 * Волна Material 3 (Android). Параметры — из реализации Material в Compose:
 * радиус растёт 225 мс от 30% размера элемента до круга, накрывающего его целиком,
 * центр при этом смещается к центру элемента; прозрачность появляется за 75 мс,
 * гаснет за 150 мс; слой состояния «нажато» — 10% цвета содержимого.
 */
export class RippleFeedback extends PressFeedback {
  private static readonly GROW_MS = 225
  private static readonly FADE_IN_MS = 75
  private static readonly FADE_OUT_MS = 150
  /** Волна видна хотя бы столько, чтобы быстрый тап не остался без отклика. */
  private static readonly MIN_VISIBLE_MS = 120
  private static readonly PRESSED_OPACITY = 0.1
  /** Запас на случай, если анимации не завершатся (вкладка ушла в фон): элемент удаляется принудительно. */
  private static readonly CLEANUP_MS = 600

  private current: Ripple | null = null

  begin(pressable: HTMLElement, point: PressPoint) {
    this.cancel()
    const host = resolveFeedbackHost(pressable)
    // Волны от предыдущих нажатий, не успевшие исчезнуть, не копим.
    host.querySelectorAll(':scope > .ripple').forEach((stale) => stale.remove())

    const box = host.getBoundingClientRect()
    const x = point.x - box.left
    const y = point.y - box.top
    // Конечный радиус — до самого дальнего угла от центра элемента (волна накрывает его целиком).
    const endRadius = Math.hypot(box.width, box.height) / 2 + 10
    const startRadius = Math.max(box.width, box.height) * 0.3
    const size = endRadius * 2

    const element = document.createElement('span')
    element.className = 'ripple'
    element.style.width = `${size}px`
    element.style.height = `${size}px`
    element.style.left = `${-endRadius}px`
    element.style.top = `${-endRadius}px`
    host.append(element)

    const from = `translate(${x}px, ${y}px) scale(${startRadius / endRadius})`
    const to = `translate(${box.width / 2}px, ${box.height / 2}px) scale(1)`
    element.animate([{ transform: from }, { transform: to }], {
      duration: RippleFeedback.GROW_MS,
      easing: 'cubic-bezier(0, 0, .2, 1)',
      fill: 'forwards',
    })
    element.animate([{ opacity: 0 }, { opacity: RippleFeedback.PRESSED_OPACITY }], {
      duration: RippleFeedback.FADE_IN_MS,
      fill: 'forwards',
    })
    this.current = { element, startedAt: performance.now() }
  }

  end() {
    this.fadeOut(RippleFeedback.MIN_VISIBLE_MS)
  }

  cancel() {
    this.fadeOut(0)
  }

  /** Гасит текущую волну, выдержав минимальное время показа, и удаляет её из DOM. */
  private fadeOut(minVisible: number) {
    const ripple = this.current
    if (!ripple) return
    this.current = null
    const { element } = ripple
    const remove = () => element.remove()
    const wait = Math.max(0, minVisible - (performance.now() - ripple.startedAt))
    window.setTimeout(() => {
      const fade = element.animate([{ opacity: RippleFeedback.PRESSED_OPACITY }, { opacity: 0 }], {
        duration: RippleFeedback.FADE_OUT_MS,
        fill: 'forwards',
      })
      fade.finished.then(remove, remove)
      window.setTimeout(remove, RippleFeedback.CLEANUP_MS)
    }, wait)
  }
}
