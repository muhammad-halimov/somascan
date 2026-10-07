import { fromTimestamp } from '../catalog/releaseDate'
import { RecognitionError } from '../RecognitionError'
import type { ModelCandidate, ProviderAccess } from '../types'
import { RecognitionProvider, type RecognitionRequest } from './RecognitionProvider'

/** Базовый URL Anthropic API. */
const API_URL = 'https://api.anthropic.com/v1'

/** Модель в `GET /v1/models`. */
interface AnthropicModel {
  /** Id модели, например `claude-sonnet-5-5`. */
  id: string
  /** Отображаемое имя, например `Claude Sonnet 5.5`. */
  display_name?: string
  /** Время выхода в формате RFC 3339. */
  created_at?: string
  /** Возможности конкретной модели; `image_input` показывает, читает ли модель изображения. */
  capabilities?: { image_input?: { supported?: boolean } }
  /** Размер контекста в токенах. */
  max_input_tokens?: number
}

/** Одна страница `GET /v1/models`. */
interface AnthropicModelPage {
  /** Модели на этой странице. */
  data?: AnthropicModel[]
  /** Есть ли следующая страница. */
  has_more?: boolean
  /** Курсор следующей страницы. */
  last_id?: string | null
}

/** Ответ `POST /v1/messages`. */
interface AnthropicResponse {
  /** Почему остановилась генерация; `refusal` и `max_tokens` считаются ошибками. */
  stop_reason?: string
  /** Блоки ответа; используются только блоки `text`. */
  content?: Array<{ type?: string; text?: string }>
}

/** Anthropic Claude (Messages API), вызывается прямо из WebView. */
export class AnthropicProvider extends RecognitionProvider {
  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  readonly id = 'anthropic' as const
  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  readonly title = 'Anthropic Claude'
  /** Числится в публичном каталоге под тем же ключом. */
  override readonly directoryId = 'anthropic'

  /** Заголовки, обязательные для каждого вызова Anthropic API. */
  private headers(apiKey: string) {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Обязателен для вызовов из браузерного контекста (у приложения нет бэкенда).
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }

  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  async listCandidates({ apiKey, signal }: ProviderAccess): Promise<ModelCandidate[]> {
    const models: AnthropicModel[] = []
    let afterId: string | null | undefined
    do {
      const query = new URLSearchParams({ limit: '1000', ...(afterId ? { after_id: afterId } : {}) })
      const page = await this.request<AnthropicModelPage>(`${API_URL}/models?${query}`, { headers: this.headers(apiKey), signal })
      models.push(...(page.data ?? []))
      afterId = page.has_more ? page.last_id : null
    } while (afterId)

    return models.map((model) => ({
      id: model.id,
      name: model.display_name || model.id,
      releasedAt: fromTimestamp(model.created_at),
      // API сообщает возможности; любая модель Claude без этого поля читает изображения.
      supportsVision: model.capabilities?.image_input?.supported ?? true,
      details: { contextTokens: model.max_input_tokens },
    }))
  }

  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  protected async complete({ image, model, prompt, access }: RecognitionRequest) {
    // Без `temperature`: актуальные модели Claude отклоняют параметры сэмплирования.
    // `max_tokens` оставляет запас на рассуждения, которые на актуальных моделях включены по умолчанию.
    const result = await this.request<AnthropicResponse>(`${API_URL}/messages`, {
      method: 'POST',
      headers: this.headers(access.apiKey),
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
      signal: access.signal,
    })

    if (result.stop_reason === 'refusal') throw new RecognitionError('refused', { provider: this.title })
    if (result.stop_reason === 'max_tokens') throw new RecognitionError('truncated', { provider: this.title })
    return result.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n')
  }
}
