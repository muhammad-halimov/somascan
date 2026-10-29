/**
 * Экранная клавиатура как в нативном приложении (плагин `@capacitor/keyboard`).
 *
 * На iOS над клавиатурой WKWebView показывает панель «‹ › Готово» — её нет у UITextField.
 * Плагин скрывает её сам при загрузке; здесь это задаётся явно. Закрыть клавиатуру можно
 * клавишей «Готово» (enterKeyHint у полей) или тапом вне поля. Сжатие экрана под клавиатуру
 * настроено в capacitor.config.ts (`Keyboard.resize: 'native'`).
 *
 * Клавиатура закрылась сама по себе (системное «Назад» или жест на Android, свайп вниз на iOS) — поле
 * теряет фокус, как в нативном приложении: иначе WebView оставляет его выделенным, хотя ввода уже нет.
 */
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'

/** Поле, в которое вводят текст. */
const EDITABLE = 'input, textarea, [contenteditable="true"]'

/** Снимает фокус с поля ввода, если он в нём остался. */
function blurEditable() {
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused.matches(EDITABLE)) focused.blur()
}

export function initKeyboard() {
  if (!Capacitor.isNativePlatform()) return
  void Keyboard.addListener('keyboardDidHide', blurEditable).catch(() => undefined)
  if (Capacitor.getPlatform() !== 'ios') return
  void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => undefined)
}
