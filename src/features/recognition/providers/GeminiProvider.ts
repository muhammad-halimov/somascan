import { findDateInText } from '../catalog/releaseDate'
import type { ModelCandidate, ProviderAccess } from '../types'
import { RecognitionProvider, type RecognitionRequest } from './RecognitionProvider'

/** Базовый URL Gemini API. */
const API_URL = 'https://generativelanguage.googleapis.com/v1beta'

/** Модель в `GET /models`. */
interface GeminiModel {
  /** Имя вида `models/<id>`. */
  name: string
  /** Версия в свободной форме; новые модели кодируют здесь месяц выхода (`3.7-flash-08-2026`). */
  version?: string
  /** Отображаемое имя, например `Gemini 3.7 Flash`. */
  displayName?: string
  /** Старые модели упоминают здесь дату выхода («released in June of 2025»). */
  description?: string
  /** Методы API, которые поддерживает модель; для распознавания нужен `generateContent`. */
  supportedGenerationMethods?: string[]
  /** Сколько токенов модель принимает на вход. */
  inputTokenLimit?: number
}

/** Одна страница `GET /models`. */
interface GeminiModelPage {
  /** Модели на этой странице. */
  models?: GeminiModel[]
  /** Токен следующей страницы; на последней отсутствует. */
  nextPageToken?: string
}

/** Ответ `generateContent`. */
interface GeminiResponse {
  /** Варианты ответа; используется первый. */
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
}

/**
 * Варианты Gemini, не превращающие фото в текст: речь, генерация изображений,
 * живое аудио, агенты, алиасы, которые незаметно меняются (`-latest`).
 */
const NOT_IMAGE_TO_TEXT = /tts|embedding|image|banana|live|audio|transcribe|translate|computer-use|robotics|customtools|latest/

/** Поколение модели по id: `gemini-3.7-flash` → 3.7. */
const generationOf = (id: string) => {
  const match = /^gemini-(\d+(?:\.\d+)?)/.exec(id)
  return match ? Number(match[1]) : null
}

/** Провайдер Google Gemini (Generative Language API). */
export class GeminiProvider extends RecognitionProvider {
  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  readonly id = 'google' as const
  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  readonly title = 'Google Gemini'
  /** Числится в публичном каталоге под тем же ключом. */
  override readonly directoryId = 'google'

  /** Только чат-модели `gemini-*`; в списке нет флагов возможностей, поэтому варианты исключаются по имени. */
  protected override isImageToTextModel(id: string) {
    return id.startsWith('gemini-') && !NOT_IMAGE_TO_TEXT.test(id)
  }

  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  async listCandidates({ apiKey, signal }: ProviderAccess): Promise<ModelCandidate[]> {
    const models: GeminiModel[] = []
    let pageToken: string | undefined
    do {
      const query = new URLSearchParams({ pageSize: '1000', ...(pageToken ? { pageToken } : {}) })
      const page = await this.request<GeminiModelPage>(`${API_URL}/models?${query}`, {
        headers: { 'x-goog-api-key': apiKey },
        signal,
      })
      models.push(...(page.models ?? []))
      pageToken = page.nextPageToken
    } while (pageToken)

    return GeminiProvider.fillMissingDates(models.map((model) => {
      const id = model.name.replace(/^models\//, '')
      return {
        id,
        name: model.displayName || id,
        releasedAt: findDateInText(`${model.version ?? ''} ${id} ${model.description ?? ''}`),
        supportsVision: (model.supportedGenerationMethods ?? []).includes('generateContent') && this.isImageToTextModel(id),
        description: model.description?.trim() || undefined,
        details: { contextTokens: model.inputTokenLimit },
      }
    }))
  }

  /**
   * У некоторых моделей Gemini нет даты вовсе (например, `gemini-3.8-flash`, версия «3.0»).
   * Такая модель не старше самой новой датированной модели того же или более раннего поколения.
   */
  private static fillMissingDates(models: ModelCandidate[]): ModelCandidate[] {
    return models.map((model) => {
      const generation = generationOf(model.id)
      if (model.releasedAt || generation === null) return model
      const releasedAt = models
        .filter((other) => other.releasedAt && (generationOf(other.id) ?? Infinity) <= generation)
        .map((other) => other.releasedAt as string)
        .sort()
        .at(-1) ?? null
      return { ...model, releasedAt }
    })
  }

  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  protected async complete({ image, model, prompt, access }: RecognitionRequest) {
    // Без `temperature`: Google рекомендует значение по умолчанию для Gemini 3+ (меньшие значения могут зацикливаться).
    const result = await this.request<GeminiResponse>(`${API_URL}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': access.apiKey },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.data } }],
        }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
      signal: access.signal,
    })
    return result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('\n')
  }
}
