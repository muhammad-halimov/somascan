import type { ProviderId } from '../types'
import { AnthropicProvider } from './AnthropicProvider'
import { GeminiProvider } from './GeminiProvider'
import { LMStudioProvider } from './LMStudioProvider'
import { OpenAIProvider } from './OpenAIProvider'
import type { RecognitionProvider } from './RecognitionProvider'

/** Поиск экземпляров провайдеров по id. */
export class ProviderRegistry {
  /** Провайдеры в порядке регистрации. */
  private readonly providers: ReadonlyMap<ProviderId, RecognitionProvider>

  /** @param providers Экземпляры провайдеров; порядок совпадает с порядком вкладок настроек. */
  constructor(providers: readonly RecognitionProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]))
  }

  /** Провайдер по id. @throws {Error} для незарегистрированного id (ошибка программиста). */
  get(id: ProviderId): RecognitionProvider {
    const provider = this.providers.get(id)
    if (!provider) throw new Error(`Provider is not registered: ${id}`)
    return provider
  }

  /** Все провайдеры в порядке регистрации. */
  all(): RecognitionProvider[] {
    return [...this.providers.values()]
  }
}

/** Провайдеры приложения. Чтобы добавить нового: унаследуйте `RecognitionProvider` и зарегистрируйте здесь. */
export const providerRegistry = new ProviderRegistry([
  new GeminiProvider(),
  new AnthropicProvider(),
  new OpenAIProvider(),
  new LMStudioProvider(),
])
