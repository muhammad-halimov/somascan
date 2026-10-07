import { useRef, useState, type ChangeEvent } from 'react'
import { ActionSheetButtonStyle } from '@capacitor/action-sheet'
import { Camera } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'
import { FilePicker } from '@capawesome/capacitor-file-picker'
import { useTranslation } from 'react-i18next'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'

/** Колбэки `usePhotoPicker`. */
export interface PhotoPickerCallbacks {
  /** Фото выбрано; `url` пригоден для показа (`blob:` или путь WebView). */
  onPicked: (url: string) => void
  /** Сбой камеры или галереи (не вызывается, когда пользователь отменил выбор). */
  onError: () => void
}

/** Порядок пунктов в нативной панели выбора источника. */
const ACTION = { take: 0, gallery: 1, files: 2, cancel: 3 } as const

/**
 * Источник фото.
 *
 * - Нативное приложение: системная панель «Сделать снимок / Выбрать из галереи /
 *   Выбрать из файлов». Снимок — плагин Camera; галерея и файлы — плагин FilePicker
 *   (системный выбор фото и «Файлы»). Галерею через Camera не открываем: он перекодирует
 *   выбранный снимок целиком, и на больших фото это секунды, в течение которых фото «не появляется».
 *   FilePicker отдаёт путь к уже готовому файлу — фото показывается сразу.
 *   Скрытый `<input type="file">` здесь не годится: после нативной панели у страницы
 *   нет «пользовательского жеста», и WebView игнорирует программный клик по нему.
 * - Веб: сразу скрытый `<input type="file">` (`inputProps` нужно передать ему через spread).
 *
 * Панель выбора — нативная (через `NativeDialogs`): на iOS системная, на Android — Material 3 в теме приложения.
 * Пока открыт выбор (камера, галерея, файлы), приложение ничего не показывает. Когда пользователь
 * вернулся из выбора, а плагин ещё готовит фото, `isReceiving` включает спиннер загрузки.
 */
export function usePhotoPicker({ onPicked, onError }: PhotoPickerCallbacks) {
  const { t } = useTranslation(['workspace', 'common'])
  const inputRef = useRef<HTMLInputElement>(null)
  /** Пользователь уже вернулся из системного выбора, а фото ещё готовится (показываем загрузку). */
  const [isReceiving, setIsReceiving] = useState(false)

  /**
   * Ждёт результат системного выбора. Выбор на Android открывается поверх приложения отдельным
   * экраном (страница скрыта); когда страница снова видна, а результата ещё нет — значит, выбор
   * сделан и плагин готовит файл: включаем загрузку. Пока выбор открыт — ничего не показываем.
   */
  const receive = async <T,>(task: Promise<T>): Promise<T> => {
    let left = document.visibilityState === 'hidden'
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') left = true
      else if (left) setIsReceiving(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    try {
      return await task
    } finally {
      document.removeEventListener('visibilitychange', onVisibility)
      setIsReceiving(false)
    }
  }

  /** Веб: открывает выбор файла через скрытое поле (вызывается прямо из нажатия). */
  const openFileInput = () => inputRef.current?.click()

  /** Нативное приложение: системный выбор файла-изображения. */
  const fromFiles = async () => {
    // Android 13+ перехватывает выбор «только изображений» системным выбором фото (той же галереей),
    // поэтому там просим любые файлы — откроется файловый менеджер — и проверяем тип сами.
    const types = Capacitor.getPlatform() === 'android' ? undefined : ['image/*']
    const { files } = await receive(FilePicker.pickFiles({ types, limit: 1 }))
    const file = files[0]
    if (file && !file.mimeType.startsWith('image/')) {
      onError()
      return
    }
    // `webPath` можно сразу показывать; если его нет — переводим нативный путь в адрес для WebView.
    const url = file?.webPath ?? (file?.path ? Capacitor.convertFileSrc(file.path) : null)
    if (url) onPicked(url)
  }

  /** Снимок с камеры (плагин Camera). */
  const fromCamera = async () => {
    const photo = await receive(Camera.takePhoto({ quality: 90, editable: 'no' }))
    if (photo?.webPath) onPicked(photo.webPath)
  }

  /** Фото из галереи — системный выбор фото без перекодирования (плагин FilePicker). */
  const fromGallery = async () => {
    // На iOS просим JPEG (skipTranscoding: false): HEIC не принимают часть провайдеров распознавания.
    const { files } = await receive(FilePicker.pickImages({ limit: 1, skipTranscoding: false }))
    const file = files[0]
    const url = file?.webPath ?? (file?.path ? Capacitor.convertFileSrc(file.path) : null)
    if (url) onPicked(url)
  }

  /** Открывает выбор источника фото. */
  const pick = async () => {
    if (!Capacitor.isNativePlatform()) {
      openFileInput()
      return
    }
    try {
      // Повторный тап, пока панель открыта, игнорируется (см. NativeDialogs).
      const selection = await NativeDialogs.showActions({
        title: t('photo.add'),
        cancelable: true,
        options: [
          { title: t('photo.take') },
          { title: t('photo.chooseFromGallery') },
          { title: t('photo.chooseFromFiles') },
          { title: t('common:cancel'), style: ActionSheetButtonStyle.Cancel },
        ],
      })
      if (!selection) return
      if (selection.index === ACTION.take) await fromCamera()
      else if (selection.index === ACTION.gallery) await fromGallery()
      else if (selection.index === ACTION.files) await fromFiles()
    } catch (error) {
      // Плагины отклоняют промис с «cancelled», когда пользователь отказался от выбора; это не ошибка.
      const message = error instanceof Error ? error.message : String(error)
      if (!message.toLowerCase().includes('cancel')) onError()
    }
  }

  /** Поле выбора файла: передаём файл-изображение и сбрасываем поле, чтобы тот же файл можно было выбрать снова. */
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file?.type.startsWith('image/')) onPicked(URL.createObjectURL(file))
  }

  return {
    pick,
    isReceiving,
    /** Свойства для скрытого поля выбора файла. */
    inputProps: { ref: inputRef, type: 'file', accept: 'image/*', onChange, tabIndex: -1, 'aria-hidden': true } as const,
  }
}
