import type { JsonRequestInit } from '@/lib/http/requestJson'
import type { ProviderAccess } from '../types'
import { RecognitionProvider, type RecognitionRequest } from './RecognitionProvider'

/** Модель в `GET /v1/models` OpenAI-совместимого сервера. */
export interface OpenAIModel {
  /** Id модели. */
  id: string
  /** Время публикации модели в Unix-секундах (только OpenAI). */
  created?: number
  /** Нативный список LM Studio: `llm` | `vlm` | `embeddings`. */
  type?: string
  /** LM Studio: автор сборки, например `lmstudio-community`. */
  publisher?: string
  /** LM Studio: архитектура, например `qwen2_vl`. */
  arch?: string
  /** LM Studio: квантизация, например `Q4_K_M`. */
  quantization?: string
  /** LM Studio: `loaded` | `not-loaded`. */
  state?: string
  /** LM Studio: наибольший контекст в токенах. */
  max_context_length?: number
}

/** Ответ `POST /v1/chat/completions`. */
interface ChatCompletionResponse {
  /** Варианты ответа; используется первый. */
  choices?: Array<{ message?: { content?: string | null } }>
}

/**
 * Основа для серверов, работающих по протоколу OpenAI Chat Completions
 * (сам OpenAI, LM Studio и другие локальные серверы).
 */
export abstract class OpenAICompatibleProvider extends RecognitionProvider {
  /** Базовый URL, оканчивающийся на `/v1`. */
  protected abstract apiBase(access: ProviderAccess): string

  /** Поля запроса, специфичные для вендора, добавляемые в тело чат-запроса. */
  protected abstract extraBody(): Record<string, unknown>

  /** Слать запросы из нативной части (сервер в локальной сети по `http://`), см. `JsonRequestInit.native`. */
  protected readonly nativeHttp: boolean = false

  /** Заголовок `Authorization`, если задан ключ (для локальных серверов необязателен). */
  protected authHeaders(apiKey: string): Record<string, string> {
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  }

  /**
   * Список моделей из `<base>/models`.
   * @param base База API для запроса; по умолчанию `apiBase(access)`.
   */
  protected async fetchModelList(access: ProviderAccess, init: JsonRequestInit = {}, base = this.apiBase(access)) {
    const page = await this.request<{ data?: OpenAIModel[] }>(`${base}/models`, {
      ...init,
      headers: this.authHeaders(access.apiKey),
      signal: access.signal,
      native: this.nativeHttp,
    })
    return page.data ?? []
  }

  /** Отправляет инструкцию и фото в виде `data:` URL одним пользовательским сообщением. */
  protected async complete({ image, model, prompt, access }: RecognitionRequest) {
    const result = await this.request<ChatCompletionResponse>(`${this.apiBase(access)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders(access.apiKey) },
      body: JSON.stringify({
        // Пустая модель позволяет локальным серверам использовать любую загруженную модель.
        model: model || undefined,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: image.dataUrl } },
          ],
        }],
        ...this.extraBody(),
      }),
      signal: access.signal,
      native: this.nativeHttp,
    })
    return result.choices?.[0]?.message?.content ?? undefined
  }
}
