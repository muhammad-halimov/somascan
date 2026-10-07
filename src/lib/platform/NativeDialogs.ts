/**
 * Системные диалоги (подтверждение, сообщение, панель действий) — строго по одному.
 *
 * Плагины Capacitor не защищены от повторного вызова: двойной тап по «Фото» открывал
 * панель действий дважды, и на Android приложение падало («Fragment already added»).
 * Здесь второй вызов, пока открыт предыдущий диалог, просто игнорируется:
 * подтверждение считается отклонённым, панель — отменённой.
 */
import { ActionSheet, type ShowActionsOptions, type ShowActionsResult } from '@capacitor/action-sheet'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { Dialog, type AlertOptions, type ConfirmOptions } from '@capacitor/dialog'

/**
 * Локальный плагин Android `NativeSheet` (см. `android/.../NativeSheetPlugin.java`): панель действий
 * Material 3 в теме приложения. Плагин `@capacitor/action-sheet` на Android всегда светлый,
 * поэтому там используется он, а на iOS — системный UIAlertController из `@capacitor/action-sheet`.
 */
const NativeSheet = registerPlugin<Pick<typeof ActionSheet, 'showActions'>>('NativeSheet')

export class NativeDialogs {
  /** Открыт ли сейчас какой-то системный диалог. */
  private static busy = false

  /** Подтверждение; `false`, если пользователь отказался или диалог уже открыт. */
  static async confirm(options: ConfirmOptions): Promise<boolean> {
    const result = await NativeDialogs.exclusive(() => Dialog.confirm(options))
    return result?.value ?? false
  }

  /** Сообщение с одной кнопкой. */
  static async alert(options: AlertOptions): Promise<void> {
    await NativeDialogs.exclusive(() => Dialog.alert(options))
  }

  /** Панель действий; `null`, если пользователь отменил выбор или панель уже открыта. */
  static async showActions(options: ShowActionsOptions): Promise<ShowActionsResult | null> {
    const sheet = Capacitor.getPlatform() === 'android' ? NativeSheet : ActionSheet
    const result = await NativeDialogs.exclusive(() => sheet.showActions(options))
    return result && result.index >= 0 ? result : null
  }

  /** Выполняет `show`, если другой диалог не открыт; иначе возвращает `null`. */
  private static async exclusive<T>(show: () => Promise<T>): Promise<T | null> {
    if (NativeDialogs.busy) return null
    NativeDialogs.busy = true
    try {
      return await show()
    } finally {
      NativeDialogs.busy = false
    }
  }
}
