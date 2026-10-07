import { fromUnixSeconds } from '../catalog/releaseDate'
import type { ModelCandidate, ProviderAccess } from '../types'
import { OpenAICompatibleProvider, type OpenAIModel } from './OpenAICompatibleProvider'

/** Семейства чат-моделей: GPT и рассуждающие модели серии `o`. */
const CHAT_FAMILY = /^(gpt-|chatgpt-|o\d)/

/**
 * В списке моделей OpenAI нет флагов возможностей, поэтому варианты, не читающие изображения
 * или не поддерживаемые Chat Completions (`-pro`, `codex`: только Responses API), исключаются по имени.
 */
const NOT_IMAGE_TO_TEXT = /audio|realtime|tts|transcribe|whisper|embedding|image|dall-e|moderation|search|instruct|codex|-pro\b|oss|latest|deep-research|computer-use|^gpt-3\.5|^gpt-4(-\d{4}|-turbo|$)|^o1-mini|^o3-mini/

/** Суффикс датированного снапшота: `gpt-5.5-2026-04-23` → `gpt-5.5`. */
const SNAPSHOT_SUFFIX = /-\d{4}-\d{2}-\d{2}$/

/** Провайдер OpenAI (Chat Completions API). */
export class OpenAIProvider extends OpenAICompatibleProvider {
  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  readonly id = 'openai' as const
  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  readonly title = 'OpenAI'
  /** Числится в публичном каталоге под тем же ключом. */
  override readonly directoryId = 'openai'

  /** Фиксированный публичный API. */
  protected apiBase() {
    return 'https://api.openai.com/v1'
  }

  /** Просим JSON-объект, чтобы ответ надёжно разбирался. */
  protected extraBody() {
    // Без `temperature`: рассуждающие модели (серия o, GPT-5+) принимают только значение по умолчанию.
    return { response_format: { type: 'json_object' } }
  }

  /** Чат-модели GPT и серии o, которые читают изображения и поддерживаются Chat Completions. */
  protected override isImageToTextModel(id: string) {
    return CHAT_FAMILY.test(id) && !NOT_IMAGE_TO_TEXT.test(id)
  }

  /** @inheritdoc Описание — в базовом классе `RecognitionProvider`. */
  async listCandidates(access: ProviderAccess): Promise<ModelCandidate[]> {
    const models = await this.fetchModelList(access)
    const ids = new Set(models.map((model) => model.id))
    // Датированный снапшот дублирует свой алиас, если в списке есть оба.
    const isDuplicateSnapshot = (model: OpenAIModel) =>
      SNAPSHOT_SUFFIX.test(model.id) && ids.has(model.id.replace(SNAPSHOT_SUFFIX, ''))

    return models
      .filter((model) => !isDuplicateSnapshot(model))
      .map((model) => ({
        id: model.id,
        name: model.id,
        releasedAt: fromUnixSeconds(model.created),
        supportsVision: this.isImageToTextModel(model.id),
      }))
  }
}
