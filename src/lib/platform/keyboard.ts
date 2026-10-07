/**
 * Экранная клавиатура как в нативном приложении (плагин `@capacitor/keyboard`).
 *
 * На iOS над клавиатурой WKWebView показывает панель «‹ › Готово» — её нет у UITextField.
 * Плагин скрывает её сам при загрузке; здесь это задаётся явно. Закрыть клавиатуру можно
 * клавишей «Готово» (enterKeyHint у полей) или тапом вне поля. Сжатие экрана под клавиатуру
 * настроено в capacitor.config.ts (`Keyboard.resize: 'native'`).
 */
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'

export function initKeyboard() {
  if (Capacitor.getPlatform() !== 'ios') return
  void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => undefined)
}
