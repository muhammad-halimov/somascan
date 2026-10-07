import { appStorage, type KeyValueStore } from '@/lib/storage/KeyValueStore'
import { StoredValue } from '@/lib/storage/StoredValue'
import { Store } from '@/lib/store/Store'
import type { Language } from '@/i18n/languages'
import type { ThemePreference } from '@/lib/theme/theme'
import { providerRegistry } from '@/features/recognition/providers/ProviderRegistry'
import type { ProviderId } from '@/features/recognition/types'
import { createDefaultLabelFields, createLabelKey, isEnabledByDefault, type LabelFieldDefinition, type LabelKey } from '@/features/recognition/label/labelFields'
import { DEFAULT_LABEL_INSTRUCTIONS } from '@/features/recognition/label/labelPrompt'
import { clearLegacySettings, readLegacySettings } from './legacySettings'
import {
  createDefaultSettings,
  parseSettings,
  type AdvancedSettings,
  type AppSettings,
  type GoogleDriveSettings,
  type SmbSettings,
  type StorageTarget,
} from './settingsSchema'

/**
 * Настройки приложения в виде наблюдаемого хранилища, сохраняемого в `localStorage` при каждом изменении.
 *
 * Замечание по безопасности: API-ключи и пароль SMB лежат в `localStorage` WebView,
 * который закрыт для других приложений, но не зашифрован. Перед выпуском функции экспорта
 * секреты нужно перенести в системное хранилище ключей (iOS Keychain / Android Keystore).
 */
export class SettingsStore extends Store<AppSettings> {
  /** Сохранённая копия настроек. */
  private readonly stored: StoredValue<AppSettings>
  /** Значения, которые восстанавливает `reset`. */
  private readonly defaults: AppSettings

  /**
   * Загружает сохранённые настройки, при первом запуске перенося их из устаревшего формата.
   * @param storage Хранилище «ключ — значение».
   * @param defaults Настройки по умолчанию.
   */
  constructor(storage: KeyValueStore, defaults: AppSettings) {
    const stored = new StoredValue(storage, 'somascan.settings.v1', (data) => parseSettings(data, defaults))
    const legacy = stored.read() ? null : readLegacySettings(storage, defaults)
    super(stored.read() ?? legacy ?? defaults)
    this.stored = stored
    this.defaults = defaults
    if (legacy) {
      stored.write(legacy)
      clearLegacySettings(storage)
    } else {
      // Сохраняем разобранные настройки сразу: так переходы формата (например, новый набор
      // полей по умолчанию) записываются один раз, а не повторяются при каждом запуске.
      stored.write(this.getSnapshot())
    }
  }

  /** Сохраняет каждый новый снимок. */
  protected override onChange(state: AppSettings) {
    this.stored.write(state)
  }

  /** Заменяет раздел «Основные» результатом `recipe(current)`. */
  private updateGeneral(recipe: (general: AppSettings['general']) => AppSettings['general']) {
    this.setState((state) => ({ ...state, general: recipe(state.general) }))
  }

  /** Задаёт язык интерфейса. */
  setLanguage(language: Language) {
    this.updateGeneral((general) => ({ ...general, language }))
  }

  /** Задаёт тему оформления. */
  setTheme(theme: ThemePreference) {
    this.updateGeneral((general) => ({ ...general, theme }))
  }

  /** Задаёт провайдера распознавания. */
  setProvider(provider: ProviderId) {
    this.updateGeneral((general) => ({ ...general, provider }))
  }

  /** Запоминает выбранную модель провайдера. */
  setModel(provider: ProviderId, model: string) {
    this.updateGeneral((general) => ({ ...general, models: { ...general.models, [provider]: model } }))
  }

  /** Задаёт API-ключ провайдера. */
  setApiKey(provider: ProviderId, apiKey: string) {
    this.updateGeneral((general) => ({ ...general, apiKeys: { ...general.apiKeys, [provider]: apiKey } }))
  }

  /** Задаёт адрес сервера провайдера, развёрнутого у пользователя. */
  setEndpoint(provider: ProviderId, endpoint: string) {
    this.updateGeneral((general) => ({ ...general, endpoints: { ...general.endpoints, [provider]: endpoint } }))
  }

  /** Выбирает, куда записывается таблица. */
  setStorageTarget(target: StorageTarget) {
    this.setState((state) => ({ ...state, storage: { ...state.storage, target } }))
  }

  /** Обновляет часть полей SMB. */
  updateSmb(patch: Partial<SmbSettings>) {
    this.setState((state) => ({ ...state, storage: { ...state.storage, smb: { ...state.storage.smb, ...patch } } }))
  }

  /** Обновляет часть полей Google Drive. */
  updateGoogleDrive(patch: Partial<GoogleDriveSettings>) {
    this.setState((state) => ({ ...state, storage: { ...state.storage, googleDrive: { ...state.storage.googleDrive, ...patch } } }))
  }

  /** Обновляет часть дополнительных параметров. */
  updateAdvanced(patch: Partial<AdvancedSettings>) {
    this.setState((state) => ({ ...state, advanced: { ...state.advanced, ...patch } }))
  }

  /** Меняет список полей бирки целиком (внутренний помощник для методов ниже). */
  private updateLabelFields(recipe: (fields: LabelFieldDefinition[]) => LabelFieldDefinition[]) {
    this.updateAdvanced({ labelFields: recipe(this.getSnapshot().advanced.labelFields) })
  }

  /** Включает или выключает поле бирки; последнее включённое поле выключить нельзя. */
  toggleLabelField(key: LabelKey) {
    this.updateLabelFields((fields) => {
      const enabledCount = fields.filter((field) => field.enabled).length
      return fields.map((field) => {
        if (field.key !== key) return field
        if (field.enabled && enabledCount <= 1) return field
        return { ...field, enabled: !field.enabled }
      })
    })
  }

  /** Включает все поля бирки. */
  enableAllLabelFields() {
    this.updateLabelFields((fields) => fields.map((field) => ({ ...field, enabled: true })))
  }

  /**
   * Меняет названия и пояснение поля. Английское название обязательно: у своих полей пустое
   * не сохраняется; у встроенных пустое означает «название по умолчанию».
   */
  updateLabelField(key: LabelKey, patch: Pick<LabelFieldDefinition, 'names' | 'hint'>) {
    const names = Object.fromEntries(Object.entries(patch.names).filter(([, value]) => value && value.trim() !== '').map(([language, value]) => [language, value!.trim()]))
    this.updateLabelFields((fields) => fields.map((field) => {
      if (field.key !== key) return field
      if (!field.builtIn && !names.en) return field
      return { ...field, names, hint: patch.hint.trim() }
    }))
  }

  /**
   * Добавляет своё поле в конец списка (включённым). Ключ создаётся из английского названия.
   * @returns Ключ нового поля или `null`, если английское название пустое.
   */
  addLabelField(patch: Pick<LabelFieldDefinition, 'names' | 'hint'>): LabelKey | null {
    const english = patch.names.en?.trim()
    if (!english) return null
    const fields = this.getSnapshot().advanced.labelFields
    const key = createLabelKey(english, fields.map((field) => field.key))
    const names = Object.fromEntries(Object.entries(patch.names).filter(([, value]) => value && value.trim() !== '').map(([language, value]) => [language, value!.trim()]))
    this.updateLabelFields((current) => [...current, { key, names: { ...names, en: english }, hint: patch.hint.trim(), kind: 'code', enabled: true, builtIn: false }])
    return key
  }

  /** Удаляет своё поле; встроенные не удаляются. Если не остаётся включённых полей — включаются основные. */
  removeLabelField(key: LabelKey) {
    this.updateLabelFields((fields) => {
      const next = fields.filter((field) => field.builtIn || field.key !== key)
      return next.some((field) => field.enabled) ? next : next.map((field) => ({ ...field, enabled: field.builtIn && isEnabledByDefault(field.key) }))
    })
  }

  /** Заменяет список полей целиком (отмена правки: возврат к снимку, сделанному при её начале). */
  setLabelFields(fields: LabelFieldDefinition[]) {
    this.updateAdvanced({ labelFields: fields })
  }

  /** Возвращает поля по умолчанию: свои поля удаляются, названия встроенных — по умолчанию, включены пять основных. */
  resetLabelFields() {
    this.updateAdvanced({ labelFields: createDefaultLabelFields() })
  }

  /** Сохраняет инструкцию для модели; совпадающая с инструкцией по умолчанию хранится как пустая. */
  setPrompt(prompt: string) {
    this.updateAdvanced({ prompt: prompt.trim() === DEFAULT_LABEL_INSTRUCTIONS.trim() ? '' : prompt })
  }

  /** Возвращает настройки по умолчанию, кроме API-ключей и хранилища (сетевой диск, Google Drive). */
  reset() {
    // Ключи и параметры хранилища долго вводить заново, а сброс нужен для остальных настроек.
    this.setState((state) => ({
      ...this.defaults,
      general: { ...this.defaults.general, apiKeys: state.general.apiKeys },
      storage: state.storage,
    }))
  }
}

/** Общие настройки приложения. */
export const settingsStore = new SettingsStore(appStorage, createDefaultSettings(providerRegistry))
