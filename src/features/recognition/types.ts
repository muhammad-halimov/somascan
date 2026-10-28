/**
 * Общие типы функциональности распознавания.
 */

/** Все поддерживаемые провайдеры распознавания в порядке показа в настройках: первым — на устройстве. */
export const PROVIDER_IDS = ['device', 'google', 'anthropic', 'openai', 'lmstudio'] as const

/** Идентификатор провайдера распознавания. */
export type ProviderId = (typeof PROVIDER_IDS)[number]

/** Проверка типа для `ProviderId`. */
export const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value)

/** Распознавание на самом устройстве (без модели). */
export const ON_DEVICE_PROVIDER = 'device' satisfies ProviderId

/** Провайдер ИИ-модели (облако или LM Studio) — всё, кроме распознавания на устройстве. */
export type ModelProviderId = Exclude<ProviderId, typeof ON_DEVICE_PROVIDER>

/** Проверка типа для `ModelProviderId`. */
export const isModelProviderId = (value: unknown): value is ModelProviderId => isProviderId(value) && value !== ON_DEVICE_PROVIDER

/** Характеристики модели из её источников (API провайдера, каталог models.dev, LM Studio). */
export interface ModelDetails {
  /** Размер контекста в токенах. */
  contextTokens?: number
  /** Цена входных токенов, долларов за миллион. */
  inputCost?: number
  /** Цена выходных токенов, долларов за миллион. */
  outputCost?: number
  /** До какой даты модель знает мир (`YYYY-MM` или `YYYY-MM-DD`). */
  knowledge?: string
  /** Квантизация локальной модели, например `Q4_K_M`. */
  quantization?: string
}

/** Модель в том виде, в каком её отдаёт провайдер, до фильтрации. */
export interface ModelCandidate {
  /** Id, отправляемый в запросах к API, например `gemini-3.7-flash`. */
  id: string
  /** Читаемое название. */
  name: string
  /** Дата выхода в формате `YYYY-MM-DD` или `null`, если неизвестна. */
  releasedAt: string | null
  /** Принимает ли модель изображение и отвечает ли текстом. */
  supportsVision: boolean
  /** Описание модели из источника (как есть, обычно по-английски). */
  description?: string
  /** Характеристики модели. */
  details?: ModelDetails
  /** Локальная модель загружена в память сервера (LM Studio); у облачных моделей не задано. */
  loaded?: boolean
}

/** Модель, предлагаемая пользователю после фильтрации. */
export type ModelInfo = Omit<ModelCandidate, 'supportsVision'>

/** Учётные данные и адрес для обращения к провайдеру. */
export interface ProviderAccess {
  /** API-ключ; пустой, если не задан. */
  apiKey: string
  /** URL сервера для самостоятельно размещаемых провайдеров; для облачных пустой. */
  endpoint: string
  /** Отменяет запрос. */
  signal?: AbortSignal
}
