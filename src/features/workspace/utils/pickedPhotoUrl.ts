import { Capacitor, registerPlugin } from '@capacitor/core'

/** Нативный импорт фото (только Android, `PhotoImportPlugin.java`): выбор с пределом и перекодирование в JPEG. */
interface PhotoImportPlugin {
  /** Системный выбор фото, где больше `limit` не отметить; фото — в порядке выбора. Отмена — ошибка «canceled». */
  pickPhotos(options: { limit: number }): Promise<{ files: PickedPhoto[] }>
  /** Копия фото `path` в JPEG; ответ — путь копии в кэше приложения. */
  toJpeg(options: { path: string }): Promise<{ path: string }>
}

const PhotoImport = registerPlugin<PhotoImportPlugin>('PhotoImport')

/**
 * Фото из галереи Android — системный выбор фото с пределом: больше `limit` (свободных ячеек) отметить нельзя.
 * Плагин FilePicker предел не передаёт (только «одно» или «сколько угодно»), поэтому выбор — свой.
 */
export const pickAndroidPhotos = (limit: number) => PhotoImport.pickPhotos({ limit })

/** Форматы, которые WebView показывает сам; фото в остальных (HEIC/HEIF и др.) на Android перекодируется. */
const WEBVIEW_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

/** Выбранный файл от плагина FilePicker. */
export interface PickedPhoto {
  /** Нативный путь или `content://`-адрес. */
  path?: string
  /** Адрес для WebView. */
  webPath?: string
  /** MIME-тип по данным системы. */
  mimeType: string
}

/** Адрес файла для WebView: `webPath`, а если его нет — нативный путь, переведённый в адрес. */
const webUrl = (file: PickedPhoto) => file.webPath ?? (file.path ? Capacitor.convertFileSrc(file.path) : null)

/**
 * Адрес выбранного фото для WebView. На Android фото в формате, который WebView не декодирует (HEIC/HEIF —
 * «эффективный формат» камеры многих телефонов), сначала перекодируется в JPEG: иначе оно не показалось бы
 * в карточке, а распознавание ответило бы «файл не изображение». Не вышло — исходный адрес.
 */
export async function pickedPhotoUrl(file: PickedPhoto): Promise<string | null> {
  if (Capacitor.getPlatform() === 'android' && file.path && !WEBVIEW_IMAGE_TYPES.has(file.mimeType.toLowerCase())) {
    try {
      const { path } = await PhotoImport.toJpeg({ path: file.path })
      return Capacitor.convertFileSrc(path)
    } catch {
      // Перекодировать не удалось (Android до 9, повреждённый файл) — исходный адрес.
    }
  }
  return webUrl(file)
}
