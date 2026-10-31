import { DEFAULT_LANGUAGE, readLanguageCode, type Language } from '@/i18n/languages'
import { DEFAULT_MODEL_AGE_LIMIT, MODEL_AGE_LIMITS, type ModelAgeLimit } from '@/features/recognition/catalog/ModelFilter'
import { DEFAULT_KNOWN_SUPPLIERS, normalizeSuppliers } from '@/features/recognition/label/knownSuppliers'
import { compactRuleLabels, type RuleLabels } from '@/features/recognition/ocr/ruleLabels'
import { BUILT_IN_FIELDS, createDefaultLabelFields, isEnabledByDefault, type LabelFieldDefinition, type LabelFieldKind } from '@/features/recognition/label/labelFields'
import { LANGUAGES } from '@/i18n/languages'
import type { ProviderRegistry } from '@/features/recognition/providers/ProviderRegistry'
import { isModelProviderId, isProviderId, PROVIDER_IDS, type ModelProviderId, type ProviderId } from '@/features/recognition/types'
import { BACKUP_RETENTION_DAYS, BACKUP_RETENTION_OPTIONS, type BackupRetentionDays } from '@/features/uploads/xlsx/BackupPolicy'
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
  /** Провайдер, используемый для распознавания: на устройстве или ИИ-модель. */
  provider: ProviderId
  /** ИИ-провайдер, выбранный последним: на него переключает «ИИ-модель», когда распознаёт телефон. */
  modelProvider: ModelProviderId
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
  /** Имя сервера или IP-адрес, например `server` или `10.0.0.5`. */
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

/**
 * «Звонок» Somasync через Firebase Firestore (`uploads/drive/firestoreBell.ts`): после записи в Google Drive
 * телефон сообщает Somasync, и тот переносит бирку в журнал на сетевом диске сразу, а не при проверке копии.
 */
export interface FirestoreBellSettings {
  /** Звонить после записи (под замком во вкладке Google Drive). */
  enabled: boolean
  /** ID проекта Firebase. */
  projectId: string
  /** Ключ Web API проекта Firebase. */
  apiKey: string
}

/** Вкладка «Хранилище»: куда попадают распознанные строки. */
export interface StorageSettings {
  /** Активная цель. */
  target: StorageTarget
  /** Настройки сетевого диска. */
  smb: SmbSettings
  /** Настройки Google Drive. */
  googleDrive: GoogleDriveSettings
  /** «Звонок» Somasync через Firebase Firestore (только для Google Drive). */
  firestore: FirestoreBellSettings
  /**
   * Лист журнала, куда пишутся бирки; пусто — лист текущего года (создаётся, если его нет). У бирки
   * можно выбрать свой лист необязательным полем «Лист».
   */
  sheet: string
  /**
   * Строгое строение таблицы: писать только в лист со всеми колонками журнала по порядку (`JOURNAL_COLUMNS`).
   * Выключено — колонки ищутся по названиям, недостающие пропускаются.
   */
  strictLayout: boolean
  /**
   * Каждая плавка — один раз: плавка, которая уже есть в журнале, в «Загрузках» или у другой бирки на экране,
   * не отправляется и не записывается. Выключено — повторы плавок разрешены (несколько бунтов одной плавки).
   */
  uniqueHeat: boolean
  /**
   * Сколько дней хранить резервные копии таблицы в папке `backups` (выбор — в «Расширенных»). Лежит в хранилище:
   * его получает движок записи вместе с остальными настройками записи.
   */
  backupDays: BackupRetentionDays
}

/**
 * Версия набора полей по умолчанию. 1 — все встроенные поля включены; 2 — пять основных
 * (производитель, марка стали, размер, плавка, вес); 3 — четыре: марка стали стала необязательной,
 * добавлено необязательное поле «Док. качества». Нетронутый выбор прежней версии при чтении
 * переводится на новый набор по умолчанию; изменённый пользователем — сохраняется.
 */
export const LABEL_FIELDS_VERSION = 3

/**
 * Версия списка поставщиков по умолчанию. 2 — добавлен SOMACO, 3 — BPM и D&D Drótáru (канаты). Сохранённый список прежней версии
 * при чтении получает добавленные названия; удалённые потом пользователем — не возвращаются.
 */
export const KNOWN_SUPPLIERS_VERSION = 3

/** Названия, добавленные в список по умолчанию в каждой версии. */
const ADDED_SUPPLIERS: Readonly<Record<number, readonly string[]>> = { 2: ['SOMACO'], 3: ['BPM', 'D&D Drótáru'] }

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
  /** Версия списка поставщиков по умолчанию, с которой сохранён список (см. `KNOWN_SUPPLIERS_VERSION`). */
  knownSuppliersVersion: number
  /** Правила распознавания на устройстве: подписи полей, изменённые пользователем (остальные — стандартные). */
  ruleLabels: RuleLabels
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
      provider: 'device',
      modelProvider: 'google',
      models: perProvider(() => ''),
      apiKeys: perProvider(() => ''),
      endpoints: perProvider((id) => registry.get(id).defaultEndpoint),
    },
    storage: {
      target: 'smb',
      smb: { host: '', share: '', filePath: DEFAULT_TABLE_FILE, domain: '', username: '', password: '' },
      googleDrive: { account: '', folder: '', fileName: DEFAULT_TABLE_FILE },
      firestore: { enabled: false, projectId: '', apiKey: '' },
      sheet: '',
      strictLayout: true,
      uniqueHeat: true,
      backupDays: BACKUP_RETENTION_DAYS,
    },
    advanced: {
      prompt: '',
      labelFields: createDefaultLabelFields(),
      labelFieldsVersion: LABEL_FIELDS_VERSION,
      knownSuppliers: [...DEFAULT_KNOWN_SUPPLIERS],
      knownSuppliersVersion: KNOWN_SUPPLIERS_VERSION,
      ruleLabels: {},
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

/**
 * Дописывает в список прежней версии названия, добавленные в список по умолчанию после неё.
 * Пустой список — пользователь сам отказался от подсказки модели — остаётся пустым.
 */
function migrateKnownSuppliers(suppliers: string[], version: number): string[] {
  const added = Object.entries(ADDED_SUPPLIERS).filter(([since]) => Number(since) > version).flatMap(([, names]) => names)
  return added.length === 0 || suppliers.length === 0 ? suppliers : normalizeSuppliers([...suppliers, ...added])
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
      // Нет сохранённого (настройки прежней версии) — ИИ-провайдер, которым распознавали до сих пор.
      modelProvider: readField(general, 'modelProvider', isModelProviderId,
        readField(general, 'provider', isModelProviderId, defaults.general.modelProvider)),
      models: readPerProvider(isRecord(general) ? general.models : undefined, defaults.general.models),
      apiKeys: readPerProvider(isRecord(general) ? general.apiKeys : undefined, defaults.general.apiKeys),
      endpoints: readPerProvider(isRecord(general) ? general.endpoints : undefined, defaults.general.endpoints),
    },
    storage: {
      target: readField(storage, 'target', isOneOf(STORAGE_TARGETS), defaults.storage.target),
      smb: withDefaultTable(readStrings(isRecord(storage) ? storage.smb : undefined, defaults.storage.smb), 'filePath', defaults.storage.smb.filePath),
      googleDrive: withDefaultTable(readStrings(isRecord(storage) ? storage.googleDrive : undefined, defaults.storage.googleDrive), 'fileName', defaults.storage.googleDrive.fileName),
      firestore: {
        enabled: readField(isRecord(storage) ? storage.firestore : undefined, 'enabled', (value): value is boolean => typeof value === 'boolean', defaults.storage.firestore.enabled),
        projectId: readField(isRecord(storage) ? storage.firestore : undefined, 'projectId', isString, defaults.storage.firestore.projectId).trim(),
        apiKey: readField(isRecord(storage) ? storage.firestore : undefined, 'apiKey', isString, defaults.storage.firestore.apiKey).trim(),
      },
      sheet: readField(storage, 'sheet', isString, defaults.storage.sheet).trim(),
      strictLayout: readField(storage, 'strictLayout', (value): value is boolean => typeof value === 'boolean', defaults.storage.strictLayout),
      uniqueHeat: readField(storage, 'uniqueHeat', (value): value is boolean => typeof value === 'boolean', defaults.storage.uniqueHeat),
      backupDays: readField(storage, 'backupDays', isOneOf(BACKUP_RETENTION_OPTIONS), defaults.storage.backupDays),
    },
    advanced: {
      prompt: readField(advanced, 'prompt', isString, defaults.advanced.prompt),
      labelFields: migrateLabelFields(
        readLabelFields(isRecord(advanced) ? advanced.labelFields : undefined, defaults.advanced.labelFields),
        readField(advanced, 'labelFieldsVersion', (value): value is number => typeof value === 'number', 1),
      ),
      labelFieldsVersion: LABEL_FIELDS_VERSION,
      knownSuppliers: migrateKnownSuppliers(
        readKnownSuppliers(isRecord(advanced) ? advanced.knownSuppliers : undefined, defaults.advanced.knownSuppliers),
        readField(advanced, 'knownSuppliersVersion', (value): value is number => typeof value === 'number', 1),
      ),
      knownSuppliersVersion: KNOWN_SUPPLIERS_VERSION,
      ruleLabels: compactRuleLabels(isRecord(advanced) ? advanced.ruleLabels : undefined),
      modelMaxAgeMonths: readField(advanced, 'modelMaxAgeMonths', isOneOf(MODEL_AGE_LIMITS), defaults.advanced.modelMaxAgeMonths),
      maxImageSide: readField(advanced, 'maxImageSide', isOneOf(IMAGE_SIZE_LIMITS), defaults.advanced.maxImageSide),
    },
  }
}
