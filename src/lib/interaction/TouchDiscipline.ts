import { TOUCH_SLOP } from './gestures'

/**
 * Поведение касаний как в нативном приложении (всё, что не относится к отклику на нажатие):
 *
 * - кольцо фокуса показывается только при навигации с клавиатуры: атрибут `data-keyboard`
 *   на `<html>` ставится по Tab/стрелкам/Enter/Space с настоящей клавиатуры и снимается
 *   при первом касании (CSS рисует `:focus-visible` только при нём);
 * - кнопки не берут фокус при касании (как нативные кнопки в режиме касаний): иначе Chromium
 *   уводил бы фокус и клавиатуру с поля ввода при тапе по «глазку» или вкладке, а кольцо фокуса
 *   всплывало бы при любой смене режима ввода; если фокус всё же остался — снимаем его после клика;
 * - касание вне поля ввода прячет клавиатуру, как в нативных приложениях: поле теряет фокус (на iOS касание пустого
 *   места фокус не снимает, и клавиатура не уходила). Прокрутка — не касание; касание другого поля переводит фокус туда,
 *   а кнопки самого поля (`data-input-group`: «глазок», очистка поиска, карандаш) клавиатуру не прячут;
 * - долгое нажатие не вызывает контекстное меню ссылок и картинок, выделение текста
 *   и перетаскивание — кроме полей ввода, где выделение и правка нужны. На кнопках и строках
 *   событие contextmenu не отменяем: Android считает отменённый жест «поглощённым» и вибрирует.
 */

/** Клавиши, которые означают навигацию с клавиатуры, а не ввод текста. */
const NAVIGATION_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape', 'Home', 'End'])

/** Код, под которым Android передаёт ввод экранной клавиатуры (это не навигация). */
const IME_KEY_CODE = 229

/** Обёртка поля ввода с его собственными кнопками: касание их — часть работы с полем, клавиатура остаётся. */
const INPUT_GROUP = '[data-input-group]'

/** Элемент, где текст редактируется: выделение, меню и фокус в нём — нативное поведение. */
export function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))
}

/** Текст, который разрешено выделять: поля ввода и блоки с `data-selectable` (см. base.css). */
function isSelectable(target: EventTarget | null): boolean {
  return isEditable(target) || (target instanceof Element && Boolean(target.closest('[data-selectable="true"]')))
}

export class TouchDiscipline {
  private readonly controller = new AbortController()
  /** Последнее взаимодействие — указатель (а не клавиатура). */
  private pointerInput = false

  attach() {
    const { signal } = this.controller
    const root = document.documentElement

    document.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === IME_KEY_CODE || !NAVIGATION_KEYS.has(event.key)) return
      // Enter и пробел внутри поля — это ввод, а не навигация.
      if ((event.key === 'Enter' || event.key === ' ') && isEditable(event.target)) return
      this.pointerInput = false
      root.dataset.keyboard = 'true'
    }, { capture: true, signal })

    document.addEventListener('pointerdown', () => {
      this.pointerInput = true
      delete root.dataset.keyboard
    }, { capture: true, passive: true, signal })

    // Кнопка не берёт фокус при нажатии указателем: отмена mousedown (в том числе эмулированного
    // после касания) оставляет фокус и клавиатуру там, где они были. Клик при этом приходит как обычно.
    document.addEventListener('mousedown', (event) => {
      const control = (event.target as Element | null)?.closest('button, [role="button"], [role="tab"], [role="radio"]')
      if (control && !isEditable(control)) event.preventDefault()
    }, { signal })

    // Если кнопка всё же оказалась в фокусе (долгое нажатие Chromium ставит фокус без mousedown),
    // снимаем его после касания — когда клик, если он будет, уже обработан.
    const releaseFocus = () => {
      if (!this.pointerInput) return
      window.setTimeout(() => {
        const focused = document.activeElement
        if (focused instanceof HTMLElement && focused.matches('button, [role="button"], [role="tab"], [role="radio"], a') && !isEditable(focused)) focused.blur()
      }, 0)
    }
    document.addEventListener('pointerup', releaseFocus, { capture: true, passive: true, signal })
    document.addEventListener('pointercancel', releaseFocus, { capture: true, passive: true, signal })

    // Касание вне поля ввода (не прокрутка) прячет клавиатуру. Мышь не трогаем: щелчок мимо поля и так снимает фокус.
    let tap: { x: number; y: number; target: EventTarget | null } | null = null
    document.addEventListener('pointerdown', (event) => {
      tap = event.pointerType === 'mouse' ? null : { x: event.clientX, y: event.clientY, target: event.target }
    }, { capture: true, passive: true, signal })
    document.addEventListener('pointermove', (event) => {
      if (tap && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TOUCH_SLOP) tap = null
    }, { capture: true, passive: true, signal })
    document.addEventListener('pointercancel', () => {
      tap = null
    }, { capture: true, passive: true, signal })
    document.addEventListener('pointerup', () => {
      const target = tap?.target
      tap = null
      const focused = document.activeElement
      if (!target || !(focused instanceof HTMLElement) || !isEditable(focused) || isEditable(target)) return
      if (target instanceof Node && focused.closest(INPUT_GROUP)?.contains(target)) return
      // После клика, если он будет: нажатая кнопка срабатывает как обычно, клавиатура уходит следом.
      window.setTimeout(() => focused.blur(), 0)
    }, { capture: true, passive: true, signal })

    document.addEventListener('contextmenu', (event) => {
      const target = event.target as Element | null
      if (!isSelectable(target) && target?.closest('a[href], img')) event.preventDefault()
    }, { signal })
    document.addEventListener('selectstart', (event) => {
      if (!isSelectable(event.target)) event.preventDefault()
    }, { signal })
    document.addEventListener('dragstart', (event) => event.preventDefault(), { signal })
  }

  detach() {
    this.controller.abort()
  }
}
