/**
 * Переключение модели в памяти локального сервера (LM Studio).
 *
 * Выбор модели в настройках выгружает из памяти прежнюю и загружает новую, чтобы первое
 * распознавание не ждало загрузки, а две модели не занимали память одновременно.
 * Сервером пользуются и другие устройства: смена сначала ждёт, пока все закончат распознавать
 * или менять модель (`ModelUseGate`), — тогда `waitingFor` — сколько устройств заняты.
 * Пока идёт переключение (ожидание и загрузка), `loadingId` — модель, которая загружается (в списке она
 * мигает жёлтым, а выбор других недоступен); затем список моделей перечитывается с сервера.
 * Переключение можно отменить (`cancel`) — и ожидание, и загрузку.
 */
import { Store } from '@/lib/store/Store'
import { LMStudioProvider, lmStudioServerKey } from '../providers/LMStudioProvider'
import { providerRegistry, type ProviderRegistry } from '../providers/ProviderRegistry'
import { toRecognitionError, type RecognitionError } from '../RecognitionError'
import { modelCatalog, type ModelCatalog, type SyncAccess } from './ModelCatalog'
import type { ModelUseGate } from './ModelUseGate'

/** Состояние переключения. */
export interface LocalModelLoaderState {
  /** Модель, на которую переключаемся (ожидание или загрузка), или `null`. */
  loadingId: string | null
  /** Смена ждёт: столько устройств сейчас распознают или меняют модель; `null` — не ждёт. */
  waitingFor: number | null
  /** Ошибка последнего переключения или `null`. */
  error: RecognitionError | null
}

/** Чем закончилось переключение. */
export type SwitchOutcome = 'loaded' | 'failed' | 'cancelled' | 'ignored'

/** Переключает загруженную модель LM Studio, по одной операции за раз. */
export class LocalModelLoader extends Store<LocalModelLoaderState> {
  /** Где искать провайдера LM Studio. */
  private readonly registry: ProviderRegistry
  /** Каталог, который перечитывается после переключения. */
  private readonly catalog: ModelCatalog
  /** Отмена текущего переключения. */
  private controller: AbortController | null = null

  /**
   * @param registry Провайдеры.
   * @param catalog Каталог моделей.
   */
  constructor(registry: ProviderRegistry, catalog: ModelCatalog) {
    super({ loadingId: null, waitingFor: null, error: null })
    this.registry = registry
    this.catalog = catalog
  }

  /**
   * Делает `id` единственной загруженной моделью. Повторный вызов во время переключения игнорируется.
   * Никогда не отклоняется: ошибка сохраняется в состоянии.
   * @param gate Очередь к серверу между устройствами; без неё смена не ждёт других.
   */
  async switchTo(id: string, access: SyncAccess, gate?: ModelUseGate): Promise<SwitchOutcome> {
    if (this.getSnapshot().loadingId !== null) return 'ignored'
    const provider = this.registry.get('lmstudio')
    if (!(provider instanceof LMStudioProvider)) return 'ignored'
    const controller = new AbortController()
    this.controller = controller
    this.setState({ loadingId: id, waitingFor: null, error: null })
    let error: RecognitionError | null = null
    let release: (() => void) | null = null
    try {
      const server = lmStudioServerKey(access.endpoint || provider.defaultEndpoint)
      release = gate
        ? await gate.acquireSwitch(server, controller.signal, (devices) => this.setState((state) => ({ ...state, waitingFor: devices })))
        : null
      this.setState((state) => ({ ...state, waitingFor: null }))
      await provider.switchModel({ ...access, signal: controller.signal }, id)
    } catch (cause) {
      if (!controller.signal.aborted) error = toRecognitionError(cause, provider.title)
    } finally {
      release?.()
      this.controller = null
    }
    // Состояние моделей (загружена или нет) — с сервера, а не по нашим ожиданиям.
    await this.catalog.sync('lmstudio', access, { force: true })
    this.setState({ loadingId: null, waitingFor: null, error })
    return controller.signal.aborted ? 'cancelled' : error ? 'failed' : 'loaded'
  }

  /** Отменяет текущее переключение: ожидание очереди или загрузку модели. */
  cancel() {
    this.controller?.abort()
  }

  /** Сбрасывает ошибку (например, при смене адреса сервера). */
  clearError() {
    if (this.getSnapshot().error) this.setState((state) => ({ ...state, error: null }))
  }
}

/** Общий для приложения загрузчик локальных моделей. */
export const localModelLoader = new LocalModelLoader(providerRegistry, modelCatalog)
