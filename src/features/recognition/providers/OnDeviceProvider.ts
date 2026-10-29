import { PHOTO_ASSESSMENT_KEY } from '../label/labelPrompt'
import { bestExtraction, extractLabel, type Extraction } from '../ocr/LabelExtractor'
import type { OcrCode, OcrPage } from '../ocr/ocrTypes'
import { TagOcr } from '../ocr/TagOcr'
import { RecognitionError } from '../RecognitionError'
import type { ModelCandidate } from '../types'
import { RecognitionProvider, type RecognitionRequest } from './RecognitionProvider'

/** Отмена («Сброс», «Повтор») между чтениями: дальше не читаем. `AbortSignal.throwIfAborted` есть не во всех WebView. */
function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new DOMException('Recognition aborted', 'AbortError')
}

/** С такой оценкой страницы (`Extraction.score`: подписи и найденные значения) поворот фото верный, другие можно не пробовать. */
const CONFIDENT_SCORE = 5

/** Повороты, которые пробуются, если в исходном мало подписей: бирку сняли боком или вверх ногами. */
const OTHER_ROTATIONS = [90, 270, 180]

/**
 * Распознавание на самом телефоне, без сети и ключей: текст бирки читает ML Kit (Android) или Apple Vision (iOS),
 * поля из него собирают правила (`LabelExtractor`) — по подписям на бирке, расположению и виду значений.
 *
 * Отвечает так же, как модель, — JSON с полями и оценкой фото, — поэтому дальше всё как у облачных провайдеров
 * (`LabelParser`, карточка бирки, обязательные поля, повторы плавок). Модели и промпта нет.
 * РИСК: правила знают подписи известных заводов; бирку с непривычными подписями они прочтут хуже модели —
 * пустые обязательные поля оператор дописывает в правке.
 */
export class OnDeviceProvider extends RecognitionProvider {
  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  readonly id = 'device' as const
  /** Название движка: ML Kit или Apple Vision. */
  readonly title = TagOcr.engine()
  /** Ключ не нужен. */
  override readonly requiresApiKey = false
  /** Модели нет. */
  override readonly allowsDefaultModel = true
  /** Распознаёт на устройстве. */
  override readonly onDevice = true

  /** Прочитанное в последний раз — для отладки правил: `__somascan.labelRecognizer.registry.get('device').lastReading` в инструментах разработчика. */
  lastReading: { pages: OcrPage[]; codes: OcrCode[]; extraction: Extraction | null } | null = null

  /** Моделей нет. */
  async listCandidates(): Promise<ModelCandidate[]> {
    return []
  }

  /**
   * Читает фото в исходном повороте; если подписей полей мало — ещё в трёх других и берёт лучший.
   * @throws {RecognitionError} `onDeviceUnavailable` в браузере, `requestFailed` при сбое движка.
   */
  protected async complete({ image, fields, suppliers, access }: RecognitionRequest): Promise<string> {
    if (!TagOcr.isAvailable()) throw new RecognitionError('onDeviceUnavailable')
    const extract = (page: OcrPage, codes: readonly OcrCode[]) => extractLabel({ page, codes, fields, suppliers })
    const first = await this.read(image.data, [0], true)
    throwIfAborted(access.signal)
    const pages = [...first.pages]
    let best = bestExtraction(pages.map((page) => extract(page, first.codes)))
    if (!best || best.score < CONFIDENT_SCORE) {
      const turned = await this.read(image.data, OTHER_ROTATIONS, false)
      throwIfAborted(access.signal)
      pages.push(...turned.pages)
      best = bestExtraction([...(best ? [best] : []), ...turned.pages.map((page) => extract(page, first.codes))])
    }
    this.lastReading = { pages, codes: first.codes, extraction: best }
    if (!best) return JSON.stringify({ [PHOTO_ASSESSMENT_KEY]: { ok: false, issues: ['noTag'] } })
    return JSON.stringify({ ...best.label, [PHOTO_ASSESSMENT_KEY]: best.photo })
  }

  /** Чтение с переводом сбоя движка в `RecognitionError`. */
  private async read(image: string, rotations: number[], codes: boolean) {
    try {
      return await TagOcr.read(image, rotations, codes)
    } catch (error) {
      throw new RecognitionError('requestFailed', { provider: this.title, detail: error instanceof Error ? error.message : String(error) })
    }
  }
}
