import { HttpError } from '@/lib/http/HttpError'
import { requestJson, type JsonRequestInit } from '@/lib/http/requestJson'
import type { InlineImage } from '../image/InlineImage'
import { ModelFilter, type ModelAgeLimit } from '../catalog/ModelFilter'
import type { DirectoryModel } from '../catalog/PublicModelDirectory'
import { fromTimestamp } from '../catalog/releaseDate'
import { isAbortError, RecognitionError } from '../RecognitionError'
import type { ModelCandidate, ModelInfo, ProviderAccess, ProviderId } from '../types'

/** Всё необходимое для распознавания одного фото. */
export interface RecognitionRequest {
  /** Фото для распознавания. */
  image: InlineImage
  /** Id модели; может быть пустым у провайдеров с `allowsDefaultModel`. */
  model: string
  /** Инструкция для модели. */
  prompt: string
  /** Учётные данные и отмена. */
  access: ProviderAccess
}

/**
 * Базовый класс интеграции с ИИ-вендором.
 *
 * Провайдер умеет две вещи: получать список своих моделей и отправлять фото на
 * распознавание. Подклассы описывают только HTTP API вендора; преобразование ошибок,
 * фильтрация моделей и проверка ответа общие и живут здесь.
 */
export abstract class RecognitionProvider {
  /** Стабильный идентификатор, он же ключ настроек. */
  abstract readonly id: ProviderId
  /** Название вендора для сообщений об ошибках. */
  abstract readonly title: string
  /** Нужен ли запросам API-ключ. */
  readonly requiresApiKey: boolean = true
  /** Выбирает ли сервер модель сам, если она не указана. */
  readonly allowsDefaultModel: boolean = false
  /** URL сервера по умолчанию для самостоятельно размещаемых провайдеров; для облачных пустой. */
  readonly defaultEndpoint: string = ''
  /** Содержит ли список моделей даты выхода (у локальных серверов их нет). */
  readonly reportsReleaseDates: boolean = true
  /** Ключ провайдера в публичном каталоге моделей или `null`, если его там нет. */
  readonly directoryId: string | null = null

  /** Можно ли выполнить запрос с этими учётными данными. */
  isConfigured(access: Pick<ProviderAccess, 'apiKey'>) {
    return !this.requiresApiKey || access.apiKey.trim() !== ''
  }

  /** Полный список моделей из API вендора, с определёнными поддержкой изображений и датами выхода. */
  abstract listCandidates(access: ProviderAccess): Promise<ModelCandidate[]>

  /**
   * Преобразует запись публичного каталога в кандидата. Нужно для предпросмотра списка
   * до ввода API-ключа; действуют те же правила по именам, что и для списка из API.
   */
  fromDirectory(model: DirectoryModel): ModelCandidate {
    return {
      id: model.id,
      name: model.name,
      releasedAt: fromTimestamp(model.releaseDate ?? undefined),
      supportsVision: model.inputs.includes('image') && this.isImageToTextModel(model.id),
      description: model.description,
      details: model.details,
    }
  }

  /**
   * Проверка по имени для моделей, читающих изображение и отвечающих текстом.
   * Вендоры, не сообщающие возможности, переопределяют её, чтобы исключить речевые,
   * генерирующие изображения, эмбеддинговые и подобные варианты.
   */
  protected isImageToTextModel(_id: string): boolean {
    return true
  }

  /** Модели, предлагаемые пользователю из (возможно, кэшированного) списка кандидатов. */
  selectModels(candidates: readonly ModelCandidate[], maxAgeMonths: ModelAgeLimit): ModelInfo[] {
    return ModelFilter.apply(candidates, { maxAgeMonths, keepUndated: !this.reportsReleaseDates })
  }

  /**
   * Отправляет фото и возвращает текстовый ответ модели.
   * @throws {RecognitionError} с кодом, описывающим сбой.
   */
  async recognize(request: RecognitionRequest): Promise<string> {
    const text = (await this.complete(request))?.trim()
    if (!text) throw new RecognitionError('emptyAnswer', { provider: this.title })
    return text
  }

  /** Запрос, специфичный для вендора; возвращает исходный текстовый ответ. */
  protected abstract complete(request: RecognitionRequest): Promise<string | undefined>

  /**
   * `requestJson` с преобразованием ошибок в `RecognitionError`.
   * Отмена со стороны вызывающего пробрасывается без изменений, чтобы её можно было игнорировать;
   * прерывание по `timeoutMs` сообщается как сетевая ошибка.
   */
  protected async request<T>(url: string, init: JsonRequestInit): Promise<T> {
    try {
      return await requestJson<T>(url, init)
    } catch (error) {
      if (isAbortError(error) && init.signal?.aborted) throw error
      if (error instanceof HttpError) {
        const detail = error.serverMessage ?? `HTTP ${error.status}`
        throw new RecognitionError(error.serverMessage === null && error.status < 300 ? 'invalidResponse' : 'requestFailed', {
          provider: this.title,
          detail,
        })
      }
      throw new RecognitionError('network', { provider: this.title, detail: error instanceof Error ? error.message : String(error) })
    }
  }
}
