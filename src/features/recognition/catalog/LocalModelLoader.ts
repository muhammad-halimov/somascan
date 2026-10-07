/**
 * Переключение модели в памяти локального сервера (LM Studio).
 *
 * Выбор модели в настройках выгружает из памяти прежнюю и загружает новую, чтобы первое
 * распознавание не ждало загрузки, а две модели не занимали память одновременно.
 * Пока идёт переключение, `loadingId` — модель, которая загружается (в списке она мигает жёлтым,
 * а выбор других недоступен); затем список моделей перечитывается с сервера.
 */
import { Store } from '@/lib/store/Store'
import { LMStudioProvider } from '../providers/LMStudioProvider'
import { providerRegistry, type ProviderRegistry } from '../providers/ProviderRegistry'
import { toRecognitionError, type RecognitionError } from '../RecognitionError'
import { modelCatalog, type ModelCatalog, type SyncAccess } from './ModelCatalog'

/** Состояние переключения. */
export interface LocalModelLoaderState {
  /** Модель, которая сейчас загружается, или `null`. */
  loadingId: string | null
  /** Ошибка последнего переключения или `null`. */
  error: RecognitionError | null
}

/** Переключает загруженную модель LM Studio, по одной операции за раз. */
export class LocalModelLoader extends Store<LocalModelLoaderState> {
  /** Где искать провайдера LM Studio. */
  private readonly registry: ProviderRegistry
  /** Каталог, который перечитывается после переключения. */
  private readonly catalog: ModelCatalog

  /**
   * @param registry Провайдеры.
   * @param catalog Каталог моделей.
   */
  constructor(registry: ProviderRegistry, catalog: ModelCatalog) {
    super({ loadingId: null, error: null })
    this.registry = registry
    this.catalog = catalog
  }

  /**
   * Делает `id` единственной загруженной моделью. Повторный вызов во время переключения игнорируется.
   * Никогда не отклоняется: ошибка сохраняется в состоянии.
   */
  async switchTo(id: string, access: SyncAccess): Promise<void> {
    if (this.getSnapshot().loadingId !== null) return
    const provider = this.registry.get('lmstudio')
    if (!(provider instanceof LMStudioProvider)) return
    this.setState({ loadingId: id, error: null })
    let error: RecognitionError | null = null
    try {
      await provider.switchModel(access, id)
    } catch (cause) {
      error = toRecognitionError(cause, provider.title)
    }
    // Состояние моделей (загружена или нет) — с сервера, а не по нашим ожиданиям.
    await this.catalog.sync('lmstudio', access, { force: true })
    this.setState({ loadingId: null, error })
  }

  /** Сбрасывает ошибку (например, при смене адреса сервера). */
  clearError() {
    if (this.getSnapshot().error) this.setState((state) => ({ ...state, error: null }))
  }
}

/** Общий для приложения загрузчик локальных моделей. */
export const localModelLoader = new LocalModelLoader(providerRegistry, modelCatalog)
