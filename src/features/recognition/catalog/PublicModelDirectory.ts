import { requestJson } from '@/lib/http/requestJson'
import { isRecord } from '@/lib/validation/guards'
import type { ModelDetails } from '../types'

/** Одна модель в публичном каталоге, сокращённая до полей, которые использует приложение. */
export interface DirectoryModel {
  /** Id модели, как его использует API провайдера. */
  id: string
  /** Отображаемое имя. */
  name: string
  /** Дата выхода (`YYYY-MM-DD` или `YYYY-MM`), если известна. */
  releaseDate: string | null
  /** Входные модальности, например `['text', 'image']`. */
  inputs: string[]
  /** Описание модели (по-английски). */
  description?: string
  /** Контекст, цены, дата знаний. */
  details: ModelDetails
}

/** Структура `https://models.dev/api.json`: `{ [provider]: { models: { [id]: model } } }`. */
type DirectoryPayload = Record<string, { models?: Record<string, unknown> }>

/**
 * Публичный каталог ИИ-моделей без ключа (models.dev, открытый исходный код, с поддержкой CORS).
 *
 * API провайдеров отдают список моделей только вызывающим с API-ключом. Пока пользователь
 * его не ввёл, экран настроек показывает предпросмотр моделей провайдера из этого каталога.
 * Весь каталог — один файл около 400 КБ (в сжатом виде), загружается один раз и общий для всех провайдеров.
 */
export class PublicModelDirectory {
  /** URL каталога. */
  static readonly URL = 'https://models.dev/api.json'

  /** Выполняющаяся или завершённая загрузка, общая для одновременных вызовов. */
  private payload: Promise<DirectoryPayload> | null = null

  /**
   * Модели одного провайдера.
   * @param directoryId Ключ провайдера в каталоге (`google`, `anthropic`, `openai`).
   */
  async models(directoryId: string): Promise<DirectoryModel[]> {
    const payload = await this.load()
    const models = payload[directoryId]?.models ?? {}
    return Object.entries(models).flatMap(([id, model]) => (isRecord(model) ? [PublicModelDirectory.toModel(id, model)] : []))
  }

  /** Загружает каталог один раз; неудачная загрузка повторяется при следующем вызове. */
  private load() {
    this.payload ??= requestJson<DirectoryPayload>(PublicModelDirectory.URL).catch((error: unknown) => {
      this.payload = null
      throw error
    })
    return this.payload
  }

  /** Выбирает используемые поля из исходной записи каталога. */
  private static toModel(id: string, model: Record<string, unknown>): DirectoryModel {
    const modalities = isRecord(model.modalities) ? model.modalities : {}
    const inputs = Array.isArray(modalities.input) ? modalities.input.filter((item): item is string => typeof item === 'string') : []
    const limit = isRecord(model.limit) ? model.limit : {}
    const cost = isRecord(model.cost) ? model.cost : {}
    const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
    const details: ModelDetails = {
      contextTokens: number(limit.context),
      inputCost: number(cost.input),
      outputCost: number(cost.output),
      knowledge: typeof model.knowledge === 'string' ? model.knowledge : undefined,
    }
    return {
      id,
      name: typeof model.name === 'string' ? model.name : id,
      releaseDate: typeof model.release_date === 'string' ? model.release_date : null,
      inputs,
      description: typeof model.description === 'string' && model.description.trim() ? model.description.trim() : undefined,
      details,
    }
  }

  /**
   * Запись каталога для модели провайдера: по точному id или по id без суффикса снапшота
   * (`gpt-5.5-2026-04-23` → `gpt-5.5`, `claude-x-20250514` → `claude-x`).
   * @returns Карта «id → запись» для быстрого поиска.
   */
  async index(directoryId: string): Promise<(id: string) => DirectoryModel | undefined> {
    const byId = new Map((await this.models(directoryId)).map((model) => [model.id, model]))
    return (id) => byId.get(id) ?? byId.get(id.replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/, ''))
  }
}

/** Общий экземпляр: одна загрузка за сессию приложения. */
export const publicModelDirectory = new PublicModelDirectory()
