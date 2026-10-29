/**
 * Обмен текстовыми файлами с системой (экспорт и импорт настроек).
 *
 * - Сохранить: в нативном приложении файл пишется во временную папку приложения и отдаётся системной панели
 *   «Поделиться» (сохранить в «Файлы», на Google Drive, отправить в мессенджер…); в браузере — скачивается.
 * - Выбрать: системный выбор файла (плагин FilePicker; в браузере — его поле выбора файла).
 */
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { FilePicker } from '@capawesome/capacitor-file-picker'

/** Пользователь закрыл панель «Поделиться» или выбор файла, ничего не выбрав: так плагины сообщают об отмене. */
const isCancel = (error: unknown) => error instanceof Error && /cancel/i.test(error.message)

/**
 * Отдаёт текстовый файл пользователю.
 * @param name Имя файла.
 * @param text Содержимое.
 * @param mimeType Тип содержимого.
 * @param title Заголовок панели «Поделиться».
 * @returns `false`, если пользователь закрыл панель.
 * @throws Ошибка записи или панели.
 */
export async function shareTextFile(name: string, text: string, mimeType: string, title: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  }
  const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 })
  try {
    await Share.share({ title, dialogTitle: title, files: [uri] })
    return true
  } catch (error) {
    if (isCancel(error)) return false
    throw error
  }
}

/**
 * Предлагает выбрать текстовый файл и читает его в UTF-8.
 * @param types Типы файлов (MIME, в браузере ещё и расширения вида `.json`). На Android выбор не сужается:
 *   файл из мессенджера или с Drive часто приходит с типом `application/octet-stream` и был бы недоступен —
 *   содержимое проверяет вызывающий.
 * @returns Текст файла; `null`, если пользователь ничего не выбрал.
 * @throws Ошибка чтения.
 */
export async function pickTextFile(types: readonly string[]): Promise<string | null> {
  try {
    const { files } = await FilePicker.pickFiles({
      types: Capacitor.getPlatform() === 'android' ? undefined : [...types],
      limit: 1,
      readData: true,
    })
    const data = files[0]?.data
    if (data === undefined) return null
    return new TextDecoder().decode(Uint8Array.from(atob(data), (char) => char.charCodeAt(0)))
  } catch (error) {
    if (isCancel(error)) return null
    throw error
  }
}
