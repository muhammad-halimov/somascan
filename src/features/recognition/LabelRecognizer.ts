import { InlineImage } from './image/InlineImage'
import { mergePhotoIssues, type PhotoIssue } from './image/PhotoQuality'
import type { LabelFieldDefinition, LabelRecord } from './label/labelFields'
import { LabelParser } from './label/LabelParser'
import { buildLabelPrompt } from './label/labelPrompt'
import { providerRegistry, type ProviderRegistry } from './providers/ProviderRegistry'
import type { ProviderAccess, ProviderId } from './types'

/** Входные данные одного распознавания. */
export interface LabelRecognitionRequest {
  /** Используемый провайдер. */
  providerId: ProviderId
  /** Id модели (может быть пустым для провайдеров, которые выбирают её сами). */
  model: string
  /** Учётные данные и отмена. */
  access: ProviderAccess
  /** URL выбранного фото. */
  imageUrl: string
  /** Предел уменьшения фото, `null` — исходный размер. */
  maxImageSide: number | null
  /** Инструкция из настроек; пустая строка — инструкция по умолчанию. */
  instructions: string
  /** Включённые поля, которые нужно прочитать с фото. */
  fields: readonly LabelFieldDefinition[]
  /** Известные поставщики — подсказка модели для плохо читаемых названий заводов. */
  suppliers?: readonly string[]
}

/** Результат распознавания. */
export interface LabelRecognition {
  /** Поля бирки. */
  label: LabelRecord
  /** Качество фото: стоит ли переснять и почему. */
  photo: PhotoVerdict
}

/** Итоговая оценка фото. */
export interface PhotoVerdict {
  /** Фото стоит переснять: так считает модель или локальная проверка. */
  retake: boolean
  /** Проблемы от модели (если она сочла фото непригодным) и от локальной проверки; может быть пустым. */
  issues: PhotoIssue[]
}

/**
 * Конвейер распознавания: URL фото → байты изображения → провайдер → разобранные поля бирки.
 * Не зависит от UI; все сбои — это `RecognitionError` (или `AbortError` при отмене).
 */
export class LabelRecognizer {
  /** Где ищутся провайдеры. */
  private readonly registry: ProviderRegistry
  /** Превращает ответ модели в поля. */
  private readonly parser: LabelParser

  /**
   * @param registry Где искать провайдеры.
   * @param parser Парсер ответа.
   */
  constructor(registry: ProviderRegistry, parser = new LabelParser()) {
    this.registry = registry
    this.parser = parser
  }

  /**
   * Распознаёт одно фото: промпт собирается из инструкции, выбранных полей и известных поставщиков;
   * заодно оценивается качество фото.
   */
  async recognize({ providerId, model, access, imageUrl, maxImageSide, instructions, fields, suppliers }: LabelRecognitionRequest): Promise<LabelRecognition> {
    const image = await InlineImage.fromUrl(imageUrl, { maxSide: maxImageSide })
    const prompt = buildLabelPrompt(instructions, fields, suppliers)
    const text = await this.registry.get(providerId).recognize({ image, model, prompt, access })
    const { label, photo } = this.parser.parseAnswer(text, fields.map((field) => field.key))
    // Проблемы, названные моделью, учитываем, только если она сочла фото непригодным.
    const issues = mergePhotoIssues(photo.ok ? [] : photo.issues, image.issues)
    return { label, photo: { retake: !photo.ok || image.issues.length > 0, issues } }
  }
}

/** Общий для приложения распознаватель. */
export const labelRecognizer = new LabelRecognizer(providerRegistry)
