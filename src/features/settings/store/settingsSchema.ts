import { DEFAULT_LANGUAGE, readLanguageCode, type Language } from '@/i18n/languages'
import { DEFAULT_MODEL_AGE_LIMIT, MODEL_AGE_LIMITS, type ModelAgeLimit } from '@/features/recognition/catalog/ModelFilter'
import { DEFAULT_KNOWN_SUPPLIERS, normalizeSuppliers } from '@/features/recognition/label/knownSuppliers'
import { BUILT_IN_FIELDS, createDefaultLabelFields, isEnabledByDefault, type LabelFieldDefinition, type LabelFieldKind } from '@/features/recognition/label/labelFields'
import { LANGUAGES } from '@/i18n/languages'
import type { ProviderRegistry } from '@/features/recognition/providers/ProviderRegistry'
import { isProviderId, PROVIDER_IDS, type ProviderId } from '@/features/recognition/types'
import { THEME_PREFERENCES, type ThemePreference } from '@/lib/theme/theme'
import { isOneOf, isRecord, isString, readField } from '@/lib/validation/guards'

/** По одному значению на каждого провайдера. */
export type PerProvider<T> = Record<ProviderId, T>

/** Вкладка «Основные»: язык и провайдер распознавания. */
export interface GeneralSettings {
  /** Язык интерфейса. */
  language: Language
  /** Тема оформления: как в системе, светлая или тёмная. */
  theme: ThemePreference
  /** Провайдер, используемый для распознавания. */
  provider: ProviderId
  /** Выбранная модель для каждого провайдера; пустое значение или модель, которой больше нет в списке, означает «самая новая из предлагаемых». */
  models: PerProvider<string>
  /** API-ключ каждого провайдера, вводится пользователем. */
  apiKeys: PerProvider<string>
  /** Адрес сервера каждого провайдера (используется только провайдерами на своём сервере). */
  endpoints: PerProvider<string>
}

/** Таблица по умолчанию — журнал проб; на сетевом диске — в корне общей папки (путь меняют, открыв замок). */
export const DEFAULT_TABLE_FILE = 'Probe otel.xlsx'

/** Куда записывается таблица `.xlsx`. */
export const STORAGE_TARGETS = ['smb', 'googleDrive'] as const

/** Цель хранения: сетевой диск Windows или Google Drive. */
export type StorageTarget = (typeof STORAGE_TARGETS)[number]

/** Сетевой диск Windows (SMB). */
export interface SmbSettings {
  /** Имя сервера или IP-адрес, например `fileserver` или `10.0.0.5`. */
  host: string
  /** Имя общего ресурса, например `Warehouse`. */
  share: string
  /** Путь к таблице внутри общего ресурса, например `Probe si Sarje Otel\Probe otel.xlsx`. */
  filePath: string
  /** Домен Windows (необязательно). */
  domain: string
  /** Имя учётной записи. */
  username: string
  /** Пароль учётной записи. Хранится только на устройстве; см. замечание в `SettingsStore`. */
  password: string
}

/** Облако Google Drive. */
export interface GoogleDriveSettings {
  /** Почта аккаунта Google после входа; пустая — вход не выполнен (токены хранит нативная часть). */
  account: string
  /** Ссылка на папку или её id, где лежит таблица. */
  folder: string
  /** Имя файла таблицы. */
  fileName: string
}

/** Вкладка «Хранилище»: куда попадают распознанные строки. */
export interface StorageSettings {
  /** Активная цель. */
  target: StorageTarget
  /** Настройки сетевого диска. */
  smb: SmbSettings
  /** Настройки Google Drive. */
  googleDrive: GoogleDriveSettings
  /**
   * Лист журнала, куда пишутся бирки; пусто — лист текущего года (создаётся, если его нет). У бирки
   * можно выбрать свой лист необязательным полем «Лист».
   */
  sheet: string
}

/**
 * Версия набора полей по умолчанию. 1 — все встроенные поля включены; 2 — пять основных
 * (производитель, марка стали, размер, плавка, вес); 3 — четыре: марка стали стала необязательной,
 * добавлено необязательное поле «Док. качества». Нетронутый выбор прежней версии при чтении
 * переводится на новый набор по умолчанию; изменённый пользователем — сохраняется.
 */
export const LABEL_FIELDS_VERSION = 3

/** Допустимые ограничения размера фото (по длинной стороне, px); `null` — отправлять оригинал фото. */
export const IMAGE_SIZE_LIMITS = [1024, 1600, 2048, null] as const

/** Ограничение размера фото. */
export type ImageSizeLimit = (typeof IMAGE_SIZE_LIMITS)[number]

/** Вкладка «Расширенные». */
export interface AdvancedSettings {
  /** Инструкция для модели (промпт); пустая строка — инструкция по умолчанию. JSON с полями добавляется автоматически. */
  prompt: string
  /** Поля бирки в порядке показа: встроенные и свои, включённые и выключенные (хотя бы одно включено). */
  labelFields: LabelFieldDefinition[]
  /** Версия набора полей по умолчанию, с которой сохранён выбор (см. `LABEL_FIELDS_VERSION`). */
  labelFieldsVersion: number
  /** Известные поставщики (по алфавиту, без повторов): подсказка модели для плохо читаемых названий заводов. */
  knownSuppliers: string[]
  /** Скрывать модели старше указанного числа месяцев; `null` — показывать все. */
  modelMaxAgeMonths: ModelAgeLimit
  /** Уменьшать фото до этого размера перед отправкой. */
  maxImageSide: ImageSizeLimit
}

/** Все сохраняемые настройки. */
export interface AppSettings {
  /** Вкладка «Основные». */
  general: GeneralSettings
  /** Вкладка «Хранилище». */
  storage: StorageSettings
  /** Вкладка «Расширенные». */
  advanced: AdvancedSettings
}

/** Строит запись со значением для каждого провайдера. */
export const perProvider = <T>(value: (id: ProviderId) => T) =>
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, value(id)])) as PerProvider<T>

/** Настройки по умолчанию; адреса берутся из значений провайдеров по умолчанию. */
export function createDefaultSettings(registry: ProviderRegistry): AppSettings {
  return {
    general: {
      language: DEFAULT_LANGUAGE,
      theme: 'system',
      provider: 'google',
      models: perProvider(() => ''),
      apiKeys: perProvider(() => ''),
      endpoints: perProvider((id) => registry.get(id).defaultEndpoint),
    },
    storage: {
      target: 'smb',
      smb: { host: '', share: '', filePath: DEFAULT_TABLE_FILE, domain: '', username: '', password: '' },
      googleDrive: { account: '', folder: '', fileName: DEFAULT_TABLE_FILE },
      sheet: '',
    },
    advanced: {
      prompt: '',
      labelFields: createDefaultLabelFields(),
      labelFieldsVersion: LABEL_FIELDS_VERSION,
      knownSuppliers: [...DEFAULT_KNOWN_SUPPLIERS],
      modelMaxAgeMonths: DEFAULT_MODEL_AGE_LIMIT,
      maxImageSide: 2048,
    },
  }
}

/** Читает строковую карту по провайдерам, оставляя значения по умолчанию для отсутствующих и неверных записей. */
function readPerProvider(source: unknown, fallback: PerProvider<string>): PerProvider<string> {
  if (!isRecord(source)) return fallback
  const valid = Object.entries(source).filter(([id, value]) => isProviderId(id) && isString(value))
  return { ...fallback, ...Object.fromEntries(valid) }
}

/** Читает объект со строковыми полями, оставляя значения по умолчанию для отсутствующих и неверных. */
function readStrings<T extends object>(source: unknown, fallback: T): T {
  const entries = Object.entries(fallback).map(([key, value]) => [key, readField(source, key, isString, value as string)])
  return Object.fromEntries(entries) as T
}

/**
 * Пустой путь или имя таблицы — таблица по умолчанию: раньше по умолчанию поле было пустым,
 * а с пустым путём записать всё равно некуда.
 */
function withDefaultTable<T extends object, K extends keyof T>(settings: T, key: K, fallback: T[K]): T {
  const value = settings[key]
  return typeof value === 'string' && value.trim() === '' ? { ...settings, [key]: fallback } : settings
}

/** Допустимые виды значения поля. */
const LABEL_FIELD_KINDS: readonly LabelFieldKind[] = ['code', 'text', 'number', 'weight', 'date', 'time']

/** Читает названия поля: только языки интерфейса и непустые строки (коды прежних версий — см. `readLanguageCode`). */
function readFieldNames(source: unknown): LabelFieldDefinition['names'] {
  if (!isRecord(source)) return {}
  const names: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    const language = readLanguageCode(key)
    // Название под нынешним кодом важнее сохранённого под прежним.
    if (language && (language === key || !(language in source))) names[language] = value
  }
  return Object.fromEntries(LANGUAGES.flatMap((language) => {
    const value = names[language]
    return isString(value) && value.trim() !== '' ? [[language, value]] : []
  }))
}

/**
 * Читает список полей бирки. Встроенные поля берут вид и пояснение из кода (они могли обновиться
 * в новой версии), а из сохранённого — только включённость и свои названия; пропавшие встроенные
 * поля возвращаются на своё место (включёнными, если они из основных). Свои поля должны иметь
 * английское название. Если не включено ни одного поля — набор по умолчанию.
 */
function readLabelFields(source: unknown, fallback: LabelFieldDefinition[]): LabelFieldDefinition[] {
  if (!Array.isArray(source)) return fallback
  const builtIns = new Map(BUILT_IN_FIELDS.map((field) => [field.key, field]))
  const seen = new Set<string>()
  const fields: LabelFieldDefinition[] = []
  for (const item of source) {
    if (!isRecord(item) || !isString(item.key) || item.key === '' || seen.has(item.key)) continue
    const names = readFieldNames(item.names)
    const enabled = item.enabled !== false
    const builtIn = builtIns.get(item.key)
    if (builtIn) {
      fields.push({ ...builtIn, names, enabled, builtIn: true })
    } else {
      if (!names.en) continue
      const kind = LABEL_FIELD_KINDS.find((value) => value === item.kind) ?? 'code'
      fields.push({ key: item.key, names: { ...names, en: names.en }, hint: isString(item.hint) ? item.hint : '', kind, enabled, builtIn: false })
    }
    seen.add(item.key)
  }
  // Встроенное поле, которого в сохранённом списке нет (добавлено в новой версии), встаёт на своё
  // место — после ближайшего предыдущего встроенного поля, — чтобы список не отличался от стандартного.
  BUILT_IN_FIELDS.forEach((builtIn, index) => {
    if (seen.has(builtIn.key)) return
    const previous = BUILT_IN_FIELDS.slice(0, index).reverse().find((field) => seen.has(field.key))
    const at = previous ? fields.findIndex((field) => field.key === previous.key) + 1 : 0
    fields.splice(at, 0, { ...builtIn, names: {}, enabled: isEnabledByDefault(builtIn.key), builtIn: true })
    seen.add(builtIn.key)
  })
  return fields.some((field) => field.enabled) ? fields : fallback
}

/**
 * Читает список известных поставщиков: только строки, без пустых и повторов.
 * Нет списка (настройки прежней версии) — список по умолчанию; пустой список — пользователь удалил всех.
 */
function readKnownSuppliers(source: unknown, fallback: string[]): string[] {
  if (!Array.isArray(source)) return fallback
  return normalizeSuppliers(source.filter(isString))
}

/** Поля, включённые по умолчанию в версии 2. */
const VERSION_2_DEFAULT_KEYS = ['producer', 'grade', 'size', 'heat', 'weight_kg']

/**
 * Переводит нетронутый выбор полей прежней версии на текущий набор по умолчанию: своих полей нет
 * и включено ровно то, что было по умолчанию в той версии (в 1 — всё, во 2 — пять основных), —
 * значит, пользователь выбор не менял, и включаются текущие основные.
 */
function migrateLabelFields(fields: LabelFieldDefinition[], version: number): LabelFieldDefinition[] {
  if (version >= LABEL_FIELDS_VERSION || fields.some((field) => !field.builtIn)) return fields
  const enabled = fields.filter((field) => field.enabled).map((field) => field.key)
  // Поля, которых в той версии ещё не было (добавлены при чтении), в сравнении не участвуют.
  const known = fields.filter((field) => field.key !== 'quality_doc' && field.key !== 'sheet')
  const untouched = version < 2
    ? known.every((field) => field.enabled)
    : enabled.length === VERSION_2_DEFAULT_KEYS.length && VERSION_2_DEFAULT_KEYS.every((key) => enabled.includes(key))
  return untouched ? fields.map((field) => ({ ...field, enabled: isEnabledByDefault(field.key) })) : fields
}

/**
 * Проверяет сохранённые настройки по полям и заполняет пробелы значениями по умолчанию,
 * чтобы одно неверное или отсутствующее поле (например, после обновления приложения) не сбрасывало всё.
 */
export function parseSettings(data: unknown, defaults: AppSettings): AppSettings {
  const general = isRecord(data) ? data.general : undefined
  const storage = isRecord(data) ? data.storage : undefined
  const advanced = isRecord(data) ? data.advanced : undefined
  return {
    general: {
      language: readLanguageCode(isRecord(general) ? general.language : undefined) ?? defaults.general.language,
      theme: readField(general, 'theme', isOneOf(THEME_PREFERENCES), defaults.general.theme),
      provider: readField(general, 'provider', isProviderId, defaults.general.provider),
      models: readPerProvider(isRecord(general) ? general.models : undefined, defaults.general.models),
      apiKeys: readPerProvider(isRecord(general) ? general.apiKeys : undefined, defaults.general.apiKeys),
      endpoints: readPerProvider(isRecord(general) ? general.endpoints : undefined, defaults.general.endpoints),
    },
    storage: {
      target: readField(storage, 'target', isOneOf(STORAGE_TARGETS), defaults.storage.target),
      smb: withDefaultTable(readStrings(isRecord(storage) ? storage.smb : undefined, defaults.storage.smb), 'filePath', defaults.storage.smb.filePath),
      googleDrive: withDefaultTable(readStrings(isRecord(storage) ? storage.googleDrive : undefined, defaults.storage.googleDrive), 'fileName', defaults.storage.googleDrive.fileName),
      sheet: readField(storage, 'sheet', isString, defaults.storage.sheet).trim(),
    },
    advanced: {
      prompt: readField(advanced, 'prompt', isString, defaults.advanced.prompt),
      labelFields: migrateLabelFields(
        readLabelFields(isRecord(advanced) ? advanced.labelFields : undefined, defaults.advanced.labelFields),
        readField(advanced, 'labelFieldsVersion', (value): value is number => typeof value === 'number', 1),
      ),
      labelFieldsVersion: LABEL_FIELDS_VERSION,
      knownSuppliers: readKnownSuppliers(isRecord(advanced) ? advanced.knownSuppliers : undefined, defaults.advanced.knownSuppliers),
      modelMaxAgeMonths: readField(advanced, 'modelMaxAgeMonths', isOneOf(MODEL_AGE_LIMITS), defaults.advanced.modelMaxAgeMonths),
      maxImageSide: readField(advanced, 'maxImageSide', isOneOf(IMAGE_SIZE_LIMITS), defaults.advanced.maxImageSide),
    },
  }
}
