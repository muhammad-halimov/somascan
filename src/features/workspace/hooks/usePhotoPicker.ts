import { useRef, useState, type ChangeEvent } from 'react'
import { ActionSheetButtonStyle } from '@capacitor/action-sheet'
import { Camera } from '@capacitor/camera'
import { Capacitor } from '@capacitor/core'
import { FilePicker } from '@capawesome/capacitor-file-picker'
import { useTranslation } from 'react-i18next'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'
import { pickedPhotoUrl, type PickedPhoto } from '../utils/pickedPhotoUrl'

/** Колбэки `usePhotoPicker`. */
export interface PhotoPickerCallbacks {
  /** Фото выбраны (по порядку выбора); адреса пригодны для показа (`blob:` или путь WebView). */
  onPicked: (urls: string[]) => void
  /** Сбой камеры или галереи (не вызывается, когда пользователь отменил выбор). */
  onError: () => void
}

/** Порядок пунктов в нативной панели выбора источника. */
const ACTION = { take: 0, gallery: 1, files: 2, cancel: 3 } as const

/**
 * Лимит для системного выбора. Плагин FilePicker на Android (и для файлов везде) знает только «одно»
 * (`1`) и «сколько угодно» (`0`): любой другой лимит открывает выбор одного фото. Поэтому для нескольких
 * просим «сколько угодно» и берём первые `limit`; только системный выбор фото iOS (PHPicker) принимает
 * точный лимит.
 */
const pickerLimit = (limit: number, exact: boolean) => (limit === 1 ? 1 : exact ? limit : 0)

/** Адреса выбранных фото для WebView, по порядку (HEIC и т. п. на Android — перекодированные в JPEG). */
const photoUrls = async (files: readonly PickedPhoto[]) =>
  (await Promise.all(files.map(pickedPhotoUrl))).filter((url): url is string => Boolean(url))

/**
 * Источник фото.
 *
 * - Нативное приложение: системная панель «Сделать снимок / Выбрать из галереи /
 *   Выбрать из файлов». Снимок — плагин Camera; галерея и файлы — плагин FilePicker
 *   (системный выбор фото и «Файлы»). Галерею через Camera не открываем: он перекодирует
 *   выбранный снимок целиком, и на больших фото это секунды, в течение которых фото «не появляется».
 *   FilePicker отдаёт путь к уже готовому файлу — фото показывается сразу. Фото в HEIC/HEIF
 *   (WebView Android их не декодирует) перекодируется в JPEG нативно (`pickedPhotoUrl`).
 *   Скрытый `<input type="file">` здесь не годится: после нативной панели у страницы
 *   нет «пользовательского жеста», и WebView игнорирует программный клик по нему.
 * - Веб: сразу скрытый `<input type="file">` (`inputProps` нужно передать ему через spread).
 *
 * Галерея и файлы позволяют выбрать несколько фото сразу (не больше `limit` — сколько свободно в сетке),
 * камера — один снимок.
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
  /** Сколько фото можно выбрать в текущем выборе (поле выбора файла в браузере читает его в `onChange`). */
  const limitRef = useRef(1)

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

  /** Нативное приложение: системный выбор файлов-изображений. */
  const fromFiles = async (limit: number) => {
    // Android 13+ перехватывает выбор «только изображений» системным выбором фото (той же галереей),
    // поэтому там просим любые файлы — откроется файловый менеджер — и проверяем тип сами.
    const types = Capacitor.getPlatform() === 'android' ? undefined : ['image/*']
    // Перекодирование — тоже под загрузкой: фото ещё готовится.
    const urls = await receive(FilePicker.pickFiles({ types, limit: pickerLimit(limit, false) }).then(({ files }) => {
      const images = files.slice(0, limit).filter((file) => file.mimeType.startsWith('image/'))
      return files.length > 0 && images.length === 0 ? null : photoUrls(images)
    }))
    if (urls === null) {
      onError()
      return
    }
    if (urls.length > 0) onPicked(urls)
  }

  /** Снимок с камеры (плагин Camera). */
  const fromCamera = async () => {
    const photo = await receive(Camera.takePhoto({ quality: 90, editable: 'no' }))
    if (photo?.webPath) onPicked([photo.webPath])
  }

  /** Фото из галереи — системный выбор фото без перекодирования (плагин FilePicker). */
  const fromGallery = async (limit: number) => {
    // На iOS просим JPEG (skipTranscoding: false): HEIC не принимают часть провайдеров распознавания.
    // На iOS выбранные фото пронумерованы по порядку (ordered) — в этом порядке они встанут в сетку.
    const exact = Capacitor.getPlatform() === 'ios'
    const urls = await receive(FilePicker.pickImages({ limit: pickerLimit(limit, exact), skipTranscoding: false, ordered: exact })
      .then(({ files }) => photoUrls(files.slice(0, limit))))
    if (urls.length > 0) onPicked(urls)
  }

  /**
   * Открывает выбор источника фото.
   * @param limit Сколько фото можно выбрать (свободные ячейки сетки), не меньше одного.
   */
  const pick = async (limit = 1) => {
    limitRef.current = Math.max(1, limit)
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
      else if (selection.index === ACTION.gallery) await fromGallery(limitRef.current)
      else if (selection.index === ACTION.files) await fromFiles(limitRef.current)
    } catch (error) {
      // Плагины отклоняют промис с «cancelled», когда пользователь отказался от выбора; это не ошибка.
      const message = error instanceof Error ? error.message : String(error)
      if (!message.toLowerCase().includes('cancel')) onError()
    }
  }

  /** Поле выбора файла: передаём файлы-изображения и сбрасываем поле, чтобы те же файлы можно было выбрать снова. */
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const images = [...(event.currentTarget.files ?? [])].filter((file) => file.type.startsWith('image/')).slice(0, limitRef.current)
    event.currentTarget.value = ''
    if (images.length > 0) onPicked(images.map((file) => URL.createObjectURL(file)))
  }

  return {
    pick,
    isReceiving,
    /** Свойства для скрытого поля выбора файла. */
    inputProps: { ref: inputRef, type: 'file', accept: 'image/*', multiple: true, onChange, tabIndex: -1, 'aria-hidden': true } as const,
  }
}
