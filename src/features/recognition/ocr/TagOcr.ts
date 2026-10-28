import { Capacitor, registerPlugin } from '@capacitor/core'
import type { OcrCode, OcrLine, OcrPage } from './ocrTypes'

/** Ответ нативного плагина (`TagOcrPlugin.java` — ML Kit, `TagOcrPlugin.swift` — Apple Vision). */
interface NativeReading {
  pages: Array<Omit<OcrPage, 'lines'> & { lines: Array<Omit<OcrLine, 'confidence'> & { confidence?: number | null }> }>
  codes: OcrCode[]
}

/** Распознавание текста и кодов на устройстве. */
interface TagOcrPlugin {
  /**
   * Читает текст фото в каждом из поворотов `rotations` (градусы по часовой стрелке: 0, 90, 180, 270)
   * и, если `codes`, коды на нём (QR, DataMatrix, штрихкоды).
   * @param image JPEG в Base64 (без префикса `data:`), уже в нужной ориентации (без поворота из EXIF).
   */
  read(options: { image: string; rotations: number[]; codes: boolean }): Promise<NativeReading>
}

const plugin = registerPlugin<TagOcrPlugin>('TagOcr')

/** Прочитанное на фото: страницы по поворотам и коды. */
export interface OcrReading {
  pages: OcrPage[]
  codes: OcrCode[]
}

/** Текст и коды фото, прочитанные на устройстве: ML Kit на Android, Apple Vision на iOS. */
export const TagOcr = {
  /** Есть ли распознавание на устройстве (только в приложении, не в браузере). */
  isAvailable: () => Capacitor.isNativePlatform(),

  /** Название движка для сообщений. */
  engine: () => (Capacitor.getPlatform() === 'ios' ? 'Apple Vision' : 'ML Kit'),

  /**
   * Читает фото.
   * @param image JPEG в Base64 без поворота из EXIF.
   * @param rotations Повороты, в которых читать текст.
   * @param codes Читать ли коды.
   */
  async read(image: string, rotations: number[], codes: boolean): Promise<OcrReading> {
    const reading = await plugin.read({ image, rotations, codes })
    return {
      pages: reading.pages.map((page) => ({
        ...page,
        lines: page.lines.map((line) => ({ ...line, confidence: typeof line.confidence === 'number' ? line.confidence : null })),
      })),
      codes: reading.codes ?? [],
    }
  },
}
