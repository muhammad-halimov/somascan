import { appStorage } from '@/lib/storage/KeyValueStore'
import { StoredValue } from '@/lib/storage/StoredValue'
import { Store } from '@/lib/store/Store'
import { isRecord } from '@/lib/validation/guards'
import { providerRegistry, type ProviderRegistry } from '../providers/ProviderRegistry'
import { toRecognitionError, type RecognitionError } from '../RecognitionError'
import { isProviderId, type ModelCandidate, type ModelInfo, type ProviderAccess, type ProviderId } from '../types'
import type { ModelAgeLimit } from './ModelFilter'
import { publicModelDirectory, type PublicModelDirectory } from './PublicModelDirectory'

/**
 * Откуда взят кэшированный список:
 * - `provider` — собственный API вендора, вызванный с ключом пользователя (достоверный источник);
 * - `directory` — публичный каталог моделей, предпросмотр, пока ключ не задан.
 */
export type CatalogSource = 'provider' | 'directory'

/** Кэшированный список моделей одного провайдера. */
export interface CatalogEntry {
  /** Когда список был получен (мс с начала эпохи). */
  fetchedAt: number
  /** Источник списка. */
  source: CatalogSource
  /** Хеш использованных учётных данных: другой ключ может видеть другие модели. */
  fingerprint: string
  /** Нефильтрованный список; фильтрация выполняется при чтении, чтобы ограничение по возрасту оставалось актуальным. */
  candidates: ModelCandidate[]
}

/** Состояние хранилища каталога. */
export interface ModelCatalogState {
  /** Кэшированные списки по провайдерам (сохраняются). */
  entries: Partial<Record<ProviderId, CatalogEntry>>
  /** Провайдеры, список которых загружается прямо сейчас. */
  loading: Partial<Record<ProviderId, boolean>>
  /** Последняя ошибка загрузки по провайдерам (не сохраняется). */
  errors: Partial<Record<ProviderId, RecognitionError>>
}

/** Учётные данные для синхронизации; отменой занимается сам каталог. */
export type SyncAccess = Omit<ProviderAccess, 'signal'>

/** Параметры `sync`. */
export interface SyncOptions {
  /** Загружать, даже если кэшированный список ещё свежий. */
  force?: boolean
}

/** Выполняющаяся загрузка одного провайдера. */
interface InFlightSync {
  /** Источник и учётные данные, с которыми она запущена. */
  key: string
  /** Отменяет загрузку. */
  controller: AbortController
  /** Завершается, когда загрузка закончена. */
  promise: Promise<void>
}

/** FNV-1a: короткая необратимая метка учётных данных, чтобы в кэше никогда не лежал сам ключ. */
function fingerprintOf({ apiKey, endpoint }: SyncAccess) {
  let hash = 0x811c9dc5
  for (const char of `${apiKey.trim()}\n${endpoint.trim()}`) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

/** Проверяет одного сохранённого кандидата (описание и характеристики необязательны). */
const isCandidate = (value: unknown): value is ModelCandidate =>
  isRecord(value)
  && typeof value.id === 'string'
  && typeof value.name === 'string'
  && (value.releasedAt === null || typeof value.releasedAt === 'string')
  && typeof value.supportsVision === 'boolean'
  && (value.description === undefined || typeof value.description === 'string')
  && (value.details === undefined || isRecord(value.details))
  && (value.loaded === undefined || typeof value.loaded === 'boolean')

/** Проверяет одну сохранённую запись. */
const isEntry = (value: unknown): value is CatalogEntry =>
  isRecord(value)
  && typeof value.fetchedAt === 'number'
  && (value.source === 'provider' || value.source === 'directory')
  && typeof value.fingerprint === 'string'
  && Array.isArray(value.candidates)
  && value.candidates.every(isCandidate)

/** Разбирает сохранённые записи, отбрасывая всё некорректное. */
function parseEntries(data: unknown): ModelCatalogState['entries'] | null {
  if (!isRecord(data)) return null
  return Object.fromEntries(Object.entries(data).filter(([id, entry]) => isProviderId(id) && isEntry(entry)))
}

/**
 * Списки моделей всех провайдеров, кэшируются на месяц и общие для всего приложения.
 *
 * - С API-ключом список берётся из API провайдера.
 * - Без ключа он берётся из публичного каталога, чтобы пользователь всё равно видел,
 *   что доступно (экран настроек показывает его серым).
 * - Список загружается заново, когда он старше `TTL_MS` или меняются учётные данные.
 */
export class ModelCatalog extends Store<ModelCatalogState> {
  /** Сколько кэшированный список остаётся свежим: 30 дней. */
  static readonly TTL_MS = 30 * 24 * 60 * 60 * 1000
  /** После неудачной загрузки автоматические синхронизации с теми же учётными данными ждут столько времени (ручное обновление не ждёт). */
  static readonly RETRY_AFTER_MS = 5 * 60 * 1000

  /** Провайдеры, у которых загружаются списки. */
  private readonly registry: ProviderRegistry
  /** Источник без ключа для предпросмотра. */
  private readonly directory: PublicModelDirectory
  /** Постоянная копия кэшированных списков. */
  private readonly stored: StoredValue<ModelCatalogState['entries']>
  /** Выполняющиеся загрузки, по одной на провайдера. */
  private readonly inFlight = new Map<ProviderId, InFlightSync>()
  /** Последняя неудачная загрузка по провайдерам: ключ источника и учётных данных, время. */
  private readonly failures = new Map<ProviderId, { key: string; at: number }>()
  /** Записи, последними сохранённые в хранилище; позволяет не перезаписывать, когда меняются только флаги загрузки и ошибок. */
  private persistedEntries: ModelCatalogState['entries']

  /**
   * @param registry Провайдеры, у которых загружаются списки.
   * @param directory Публичный каталог для предпросмотра без ключа.
   * @param stored Постоянное хранилище кэшированных списков.
   */
  constructor(registry: ProviderRegistry, directory: PublicModelDirectory, stored: StoredValue<ModelCatalogState['entries']>) {
    super({ entries: stored.read() ?? {}, loading: {}, errors: {} })
    this.registry = registry
    this.directory = directory
    this.stored = stored
    this.persistedEntries = this.getSnapshot().entries
  }

  /** Сохраняет кэшированные списки при каждом изменении (флаги загрузки и ошибок временные). */
  protected override onChange(state: ModelCatalogState) {
    if (state.entries === this.persistedEntries) return
    this.persistedEntries = state.entries
    this.stored.write(state.entries)
  }

  /** Откуда брать список для этих учётных данных или `null`, если загрузить его нельзя. */
  private sourceFor(id: ProviderId, access: SyncAccess): { source: CatalogSource; fingerprint: string } | null {
    const provider = this.registry.get(id)
    if (provider.isConfigured(access)) return { source: 'provider', fingerprint: fingerprintOf(access) }
    if (provider.directoryId) return { source: 'directory', fingerprint: 'public' }
    return null
  }

  /**
   * Получен ли кэшированный список с этими учётными данными (тот же источник, ключ и адрес).
   * Список другого сервера показывать нельзя: у LM Studio по другому адресу — другие модели.
   */
  matches(id: ProviderId, access: SyncAccess) {
    const target = this.sourceFor(id, access)
    const entry = this.getSnapshot().entries[id]
    return Boolean(target && entry && entry.source === target.source && entry.fingerprint === target.fingerprint)
  }

  /** Отсутствует ли кэшированный список, устарел ли он или получен с другими учётными данными. */
  needsSync(id: ProviderId, access: SyncAccess, now = Date.now()) {
    const target = this.sourceFor(id, access)
    if (!target) return false
    const entry = this.getSnapshot().entries[id]
    return !entry
      || now - entry.fetchedAt > ModelCatalog.TTL_MS
      || entry.source !== target.source
      || entry.fingerprint !== target.fingerprint
  }

  /**
   * Загружает список одного провайдера при необходимости (или всегда, с `force`).
   * Более новая синхронизация с другими учётными данными отменяет выполняющуюся; идентичная переиспользует её.
   * Никогда не отклоняется: сбои сохраняются в `errors`.
   */
  sync(id: ProviderId, access: SyncAccess, { force = false }: SyncOptions = {}): Promise<void> {
    const target = this.sourceFor(id, access)
    if (!target) return Promise.resolve()
    if (!force && !this.needsSync(id, access)) {
      // Список для этих учётных данных свежий: ошибка от прежнего адреса или ключа больше не относится к нему.
      if (this.getSnapshot().errors[id]) this.setState((state) => ({ ...state, errors: { ...state.errors, [id]: undefined } }))
      return Promise.resolve()
    }

    const key = `${target.source}:${target.fingerprint}`
    // Не долбим недоступный сервер: автоматические повторы ждут, ручное обновление проходит.
    const failure = this.failures.get(id)
    if (!force && failure?.key === key && Date.now() - failure.at < ModelCatalog.RETRY_AFTER_MS) return Promise.resolve()

    const running = this.inFlight.get(id)
    if (running && running.key === key && !force) return running.promise
    running?.controller.abort()

    const controller = new AbortController()
    const promise = this.fetchEntry(id, access, target.source, target.fingerprint, controller.signal)
      .then((ok) => {
        if (ok) this.failures.delete(id)
        else if (!controller.signal.aborted) this.failures.set(id, { key, at: Date.now() })
      })
      .finally(() => {
        if (this.inFlight.get(id)?.controller === controller) this.inFlight.delete(id)
      })
    this.inFlight.set(id, { key, controller, promise })
    return promise
  }

  /** Синхронизирует всех провайдеров; `accessOf` отдаёт учётные данные каждого. */
  syncAll(accessOf: (id: ProviderId) => SyncAccess, options?: SyncOptions) {
    return Promise.all(this.registry.all().map(({ id }) => this.sync(id, accessOf(id), options)))
  }

  /**
   * Загружает один список и сохраняет результат или ошибку.
   * @returns `true` при успехе.
   */
  private async fetchEntry(id: ProviderId, access: SyncAccess, source: CatalogSource, fingerprint: string, signal: AbortSignal): Promise<boolean> {
    const provider = this.registry.get(id)
    this.setState((state) => ({
      ...state,
      loading: { ...state.loading, [id]: true },
      errors: { ...state.errors, [id]: undefined },
    }))
    try {
      const candidates = source === 'provider'
        ? await this.withDirectoryInfo(provider.directoryId, await provider.listCandidates({ ...access, signal }))
        : (await this.directory.models(provider.directoryId ?? '')).map((model) => provider.fromDirectory(model))
      if (signal.aborted) return false
      this.setState((state) => ({
        ...state,
        entries: { ...state.entries, [id]: { fetchedAt: Date.now(), source, fingerprint, candidates } },
        loading: { ...state.loading, [id]: false },
      }))
      return true
    } catch (error) {
      // Вытеснена более новой синхронизацией или сбросом: теперь состоянием владеет она.
      if (signal.aborted) return false
      this.setState((state) => ({
        ...state,
        loading: { ...state.loading, [id]: false },
        errors: { ...state.errors, [id]: toRecognitionError(error, source === 'provider' ? provider.title : 'models.dev') },
      }))
      return false
    }
  }

  /**
   * Дополняет список из API провайдера описанием и характеристиками из публичного каталога
   * (API Anthropic и OpenAI описаний не отдают). Данные провайдера важнее; сбой каталога не мешает списку.
   */
  private async withDirectoryInfo(directoryId: string | null, candidates: ModelCandidate[]): Promise<ModelCandidate[]> {
    if (!directoryId) return candidates
    try {
      const find = await this.directory.index(directoryId)
      return candidates.map((candidate) => {
        const entry = find(candidate.id)
        if (!entry) return candidate
        const own = Object.fromEntries(Object.entries(candidate.details ?? {}).filter(([, value]) => value !== undefined))
        return { ...candidate, description: candidate.description ?? entry.description, details: { ...entry.details, ...own } }
      })
    } catch {
      return candidates
    }
  }

  /**
   * Модели, предлагаемые для провайдера в данном снимке состояния.
   * @param maxAgeMonths Ограничение по возрасту из расширенных настроек.
   */
  modelsOf(state: ModelCatalogState, id: ProviderId, maxAgeMonths: ModelAgeLimit): ModelInfo[] {
    const entry = state.entries[id]
    return entry ? this.registry.get(id).selectModels(entry.candidates, maxAgeMonths) : []
  }

  /** Отменяет выполняющиеся загрузки и забывает все кэшированные списки. */
  clear() {
    for (const running of this.inFlight.values()) running.controller.abort()
    this.inFlight.clear()
    this.failures.clear()
    this.setState({ entries: {}, loading: {}, errors: {} })
  }
}

// Прежние версии приложения кэшировали списки под этими ключами в несовместимом формате.
// v3 — без описаний моделей: удаляем, чтобы списки загрузились заново уже с ними.
for (const legacyKey of ['somascan_cached_models_v1', 'somascan_model_catalog_v2', 'somascan.modelCatalog.v3']) appStorage.remove(legacyKey)

/** Общий для приложения каталог. */
export const modelCatalog = new ModelCatalog(
  providerRegistry,
  publicModelDirectory,
  new StoredValue(appStorage, 'somascan.modelCatalog.v4', parseEntries),
)
