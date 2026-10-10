import type { JsonRequestInit } from '@/lib/http/requestJson'
import { RecognitionError } from '../RecognitionError'
import type { ModelCandidate, ProviderAccess } from '../types'
import { OpenAICompatibleProvider } from './OpenAICompatibleProvider'

/** Модель в `GET /api/v1/models` (REST API LM Studio 0.4+). */
interface LmStudioV1Model {
  /** `llm` (в том числе с поддержкой изображений) | `embedding`. */
  type?: string
  /** Ключ модели — тот же id, что в `/v1/models`. */
  key: string
  /** Загруженные экземпляры модели. */
  loaded_instances?: Array<{ id: string }>
}

/** Сколько ждать выгрузки модели из памяти. */
const UNLOAD_TIMEOUT_MS = 60_000
/** Сколько ждать загрузки модели в память (несколько гигабайт с диска). */
const LOAD_TIMEOUT_MS = 300_000

/** Порт LM Studio по умолчанию. */
const DEFAULT_PORT = '1234'

/**
 * Адрес LM Studio в виде `http://host:port/v1`.
 * Терпит адрес без схемы, без порта (для `http` подставляется 1234), с `/v1` или без, с лишними слэшами и пробелами.
 */
export function normalizeLmStudioEndpoint(input: string): string {
  const text = input.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`
  try {
    const url = new URL(withScheme)
    // Порт по умолчанию — только для простого http (https обычно за прокси на 443).
    const hasPort = /:\d+(?:\/|$)/.test(withScheme.replace(/^[a-z]+:\/\//i, ''))
    if (url.protocol === 'http:' && !hasPort) url.port = DEFAULT_PORT
    const path = url.pathname.replace(/\/+$/, '')
    url.pathname = path.endsWith('/v1') ? path : `${path}/v1`
    return url.toString().replace(/\/+$/, '')
  } catch {
    const base = withScheme.replace(/\/+$/, '')
    return base.endsWith('/v1') ? base : `${base}/v1`
  }
}

/**
 * Сервер LM Studio как `host:port` (`192.168.1.14` → `192.168.1.14:1234`): по нему устройства понимают,
 * что работают с одним и тем же сервером (очередь к нему — `ModelUseGate`).
 */
export function lmStudioServerKey(input: string): string {
  const base = normalizeLmStudioEndpoint(input)
  try {
    const url = new URL(base)
    return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`.toLowerCase()
  } catch {
    return base.toLowerCase()
  }
}

/** Локальный сервер может быть выключен или занят распознаванием; ждём списка до 8 с (по Wi-Fi он отвечает медленнее), не дольше. */
const LIST_TIMEOUT_MS = 8000

/**
 * LM Studio в сети предприятия: OpenAI-совместимый локальный сервер, фото не покидают площадку.
 *
 * Его нативный REST API (`/api/v0/models`) помечает модели с поддержкой изображений как `type: "vlm"`;
 * серверы без него переходят на OpenAI-совместимый список. У локальных моделей нет дат выхода,
 * поэтому ограничения по возрасту нет, а API-ключ не требуется.
 */
export class LMStudioProvider extends OpenAICompatibleProvider {
  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  readonly id = 'lmstudio' as const
  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  readonly title = 'LM Studio'
  /** Локальному серверу ключ не нужен (его всё же можно задать, если сервер требует). */
  override readonly requiresApiKey = false
  /** Если модель не указана, LM Studio использует загруженную. */
  override readonly allowsDefaultModel = true
  /** У локальных моделей нет дат выхода. */
  override readonly reportsReleaseDates = false
  /** Адрес LM Studio по умолчанию на той же машине. */
  override readonly defaultEndpoint = 'http://localhost:1234/v1'

  /** Сервер в локальной сети по `http://`: WebView такие запросы блокирует, шлём их нативно. */
  protected override readonly nativeHttp = true

  /**
   * Введённый адрес, приведённый к виду `http://host:port/v1`: без схемы — `http://`,
   * без порта — порт LM Studio по умолчанию (`192.168.1.14` → `http://192.168.1.14:1234/v1`).
   */
  protected apiBase({ endpoint }: ProviderAccess) {
    return normalizeLmStudioEndpoint(endpoint || this.defaultEndpoint)
  }

  /**
   * Сетевая ошибка с адресом сервера в сообщении: «Нет связи с LM Studio (192.168.1.14:1234)» —
   * сразу видно, куда приложение стучится (например, если в настройках остался `localhost`).
   */
  protected override async request<T>(url: string, init: JsonRequestInit): Promise<T> {
    try {
      return await super.request<T>(url, init)
    } catch (error) {
      if (error instanceof RecognitionError && error.code === 'network') {
        let host = url
        try {
          host = new URL(url).host
        } catch {
          // Оставляем адрес как есть.
        }
        throw new RecognitionError('network', { ...error.params, provider: `${this.title} (${host})` })
      }
      throw error
    }
  }

  /**
   * Делает `id` единственной загруженной моделью: выгружает из памяти остальные языковые модели
   * (эмбеддинговые не трогает) и загружает выбранную, если она ещё не в памяти.
   * Нужен REST API LM Studio 0.4+ (`/api/v1/models`, `…/load`, `…/unload`).
   * @throws {RecognitionError} Сервер недоступен или отказал.
   */
  async switchModel(access: ProviderAccess, id: string): Promise<void> {
    const base = this.apiBase(access).replace(/\/v1$/, '/api/v1')
    const headers = { 'Content-Type': 'application/json', ...this.authHeaders(access.apiKey) }
    const post = (path: string, body: unknown, timeoutMs: number) =>
      this.request<unknown>(`${base}/models/${path}`, { method: 'POST', headers, body: JSON.stringify(body), timeoutMs, native: this.nativeHttp, signal: access.signal })
    const { models = [] } = await this.request<{ models?: LmStudioV1Model[] }>(`${base}/models`, {
      headers,
      timeoutMs: LIST_TIMEOUT_MS,
      native: this.nativeHttp,
      signal: access.signal,
    })
    // Сначала освобождаем память: двум моделям по несколько гигабайт её может не хватить.
    for (const model of models) {
      if (model.type === 'embedding' || model.type === 'embeddings' || model.key === id) continue
      for (const instance of model.loaded_instances ?? []) await post('unload', { instance_id: instance.id }, UNLOAD_TIMEOUT_MS)
    }
    const target = models.find((model) => model.key === id)
    if (!target?.loaded_instances?.length) await post('load', { model: id }, LOAD_TIMEOUT_MS)
  }

  /** Низкая температура для локальных моделей. */
  protected extraBody() {
    // Локальные модели надёжнее следуют инструкции про JSON при низкой температуре.
    return { temperature: 0.1 }
  }

  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  async listCandidates(access: ProviderAccess): Promise<ModelCandidate[]> {
    try {
      const nativeBase = this.apiBase(access).replace(/\/v1$/, '/api/v0')
      const models = await this.fetchModelList(access, { timeoutMs: LIST_TIMEOUT_MS }, nativeBase)
      return models.map((model) => ({
        id: model.id,
        name: model.id,
        releasedAt: null,
        supportsVision: model.type === 'vlm',
        details: { contextTokens: model.max_context_length, quantization: model.quantization },
        loaded: model.state === 'loaded',
      }))
    } catch (error) {
      // Отменено или сервер недоступен: второй запрос завершился бы так же.
      // Иначе (например, 404 от сервера без нативного API) пробуем OpenAI-совместимый список.
      if (access.signal?.aborted || (error instanceof RecognitionError && error.code === 'network')) throw error
    }
    const models = await this.fetchModelList(access, { timeoutMs: LIST_TIMEOUT_MS })
    // Информации о типе нет: оставляем всё, кроме эмбеддинговых моделей.
    return models.map((model) => ({ id: model.id, name: model.id, releasedAt: null, supportsVision: !/embed/i.test(model.id) }))
  }
}
