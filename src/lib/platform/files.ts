/**
 * Обмен текстовыми файлами с системой (экспорт и импорт настроек).
 *
 * - Сохранить: в нативном приложении файл пишется во временную папку приложения и отдаётся системной панели
 *   «Поделиться» (сохранить в «Файлы», на Google Drive, отправить в мессенджер…); в браузере — скачивается.
 * - Выбрать: системный выбор файла нужного типа (плагин FilePicker; в браузере — его поле выбора файла).
 */
import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { FilePicker, type PickedFile } from '@capawesome/capacitor-file-picker'

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

/** Самый большой файл, который читается: списки настроек — килобайты, а фото или видео, выбранное по ошибке, в память не грузится. */
export const MAX_TEXT_FILE_BYTES = 1024 * 1024

/** Почему выбранный файл не прочитан: не того типа или слишком большой. */
export class PickedFileError extends Error {
  readonly reason: 'wrongType' | 'tooLarge'

  /** @param reason Причина. */
  constructor(reason: 'wrongType' | 'tooLarge') {
    super(reason)
    this.name = 'PickedFileError'
    this.reason = reason
  }
}

/** Какие файлы можно выбрать. */
export interface TextFileType {
  /** MIME-тип, например `application/json`: по нему система показывает в выборе только такие файлы. */
  mimeType: string
  /** Расширение с точкой, например `.json`: файл с ним подходит, даже если система не знает его типа. */
  extension: string
}

/**
 * Предлагает выбрать текстовый файл и читает его в UTF-8. Выбор показывает только файлы типа `type`; файл
 * другого типа или больше `MAX_TEXT_FILE_BYTES` не читается — сначала проверяются имя, тип и размер, затем
 * содержимое загружается по адресу для WebView, а не через мост плагина в Base64 (там файл раздувается в памяти).
 * @returns Текст файла; `null`, если пользователь ничего не выбрал.
 * @throws {PickedFileError} Файл не того типа или слишком большой; другая ошибка — сбой чтения.
 */
export async function pickTextFile(type: TextFileType): Promise<string | null> {
  let file: PickedFile | undefined
  try {
    // В браузере выбор понимает и расширение; нативный — только MIME-тип.
    const types = Capacitor.isNativePlatform() ? [type.mimeType] : [type.mimeType, type.extension]
    file = (await FilePicker.pickFiles({ types, limit: 1 })).files[0]
  } catch (error) {
    if (isCancel(error)) return null
    throw error
  }
  if (!file) return null
  const matches = file.name.toLowerCase().endsWith(type.extension) || file.mimeType.toLowerCase() === type.mimeType
  if (!matches) throw new PickedFileError('wrongType')
  if (file.size > MAX_TEXT_FILE_BYTES) throw new PickedFileError('tooLarge')
  const url = file.webPath ?? (file.path ? Capacitor.convertFileSrc(file.path) : null)
  if (!url) throw new Error('No file path')
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()
    // Размер мог быть неизвестен системе — проверяем ещё раз по прочитанному.
    if (blob.size > MAX_TEXT_FILE_BYTES) throw new PickedFileError('tooLarge')
    return await blob.text()
  } finally {
    if (file.blob) URL.revokeObjectURL(url)
  }
}
