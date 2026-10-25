/**
 * Настройки приложения: строение, значения по умолчанию и разбор сохранённого файла.
 *
 * Хранит их главный процесс (`host/SettingsStore`) в `userData/state.json`; окно получает копию
 * без пароля сетевого диска. Каждое поле разбирается отдельно: одно испорченное поле не сбрасывает остальные.
 */

// ── Проверки данных извне (файл настроек, JSON) ─────────────────────────────

/** Простой объект (не `null` и не массив). */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Строит проверку, которая принимает только перечисленные литеральные значения. */
export const isOneOf = <T extends string | number>(values: readonly T[]) =>
  (value: unknown): value is T => (values as readonly unknown[]).includes(value)

/** Строка `source[key]` или `fallback`. */
export const readString = (source: unknown, key: string, fallback: string): string =>
  isRecord(source) && typeof source[key] === 'string' ? (source[key] as string) : fallback

/** Логическое `source[key]` или `fallback`. */
export const readBoolean = (source: unknown, key: string, fallback: boolean): boolean =>
  isRecord(source) && typeof source[key] === 'boolean' ? (source[key] as boolean) : fallback

/** Конечное число `source[key]` или `fallback`. */
export const readNumber = (source: unknown, key: string, fallback: number): number =>
  isRecord(source) && typeof source[key] === 'number' && Number.isFinite(source[key]) ? (source[key] as number) : fallback

/** Массив из элементов, прошедших `guard` (остальные отбрасываются), или `fallback`, если массива нет. */
export function readArray<T>(source: unknown, key: string, guard: (value: unknown) => value is T, fallback: T[]): T[] {
  if (!isRecord(source) || !Array.isArray(source[key])) return fallback
  return (source[key] as unknown[]).filter(guard)
}

/** Проект: как он называется в Consum и на каком листе Sarjele живут его блоки. */
export interface ProjectSettings {
  /** Название, как в Consum. */
  name: string
  /** Другие написания того же проекта в Consum. */
  aliases: string[]
  /** Лист в Sarjele. */
  sheet: string
  /** Буквы ID элементов (пусто — подбираются по названию). */
  prefix: string
  /** Создать лист, если его нет. */
  create: boolean
  /** Обрабатывать ли проект. */
  enabled: boolean
  /** Лист закрыт замком от случайной правки (вкладка «Связи»). */
  locked: boolean
}

/** Языки интерфейса по порядку в выборе. */
export const LANGUAGES = ['en', 'ro', 'tj', 'ru'] as const
/** Язык интерфейса. */
export type Language = (typeof LANGUAGES)[number]
/**
 * Формат дат и чисел языка. Таджикского (`tg`) в Chromium нет — даты и числа как в русском (24 часа, пробел в тысячах).
 */
export const LOCALES: Record<Language, string> = { en: 'en-GB', ro: 'ro-RO', tj: 'ru-RU', ru: 'ru-RU' }

/** Тема окна. */
export const THEMES = ['system', 'light', 'dark'] as const
/** Тема окна: как в системе, светлая или тёмная. */
export type ThemePreference = (typeof THEMES)[number]

/** Где лежат таблицы. */
export const TARGETS = ['local', 'smb'] as const
/** Где лежат таблицы: на этом компьютере или на сетевом диске. */
export type StorageTarget = (typeof TARGETS)[number]

/** С какой плавки брать металл. */
export const RULES = ['latest', 'oldest'] as const
/** Правило выбора плавки: с последней использованной или с самой старой незакрытой. */
export type HeatRule = (typeof RULES)[number]

/** Самый длинный интервал проверки и пауза после изменения, с. */
export const MAX_INTERVAL_SEC = 10

/** Вид файла в «Хранилище». */
export type FileKind = 'consum' | 'sarjele' | 'probe'

/** Маска пароля для окна: сам пароль окно получает только по нажатию на «глазок». */
export const PASSWORD_MASK = '••••••••'

/** Сетевой диск Windows (SMB). Пароль хранится зашифрованным (Keychain), в окно не отдаётся. */
export interface SmbSettings {
  host: string
  share: string
  domain: string
  username: string
  password: string
}

/** Файлы одного места хранения. */
export interface FileSet {
  /** Consum (обычно один). */
  consums: string[]
  sarjele: string
  probe: string
}

/** Все настройки. */
export interface AppSettings {
  /** Воля пользователя: запущено ли слежение (переживает перезапуск). */
  running: boolean
  /** Записывать в файлы (иначе — пробный режим: только план). */
  write: boolean
  language: Language
  theme: ThemePreference
  target: StorageTarget
  /** Файлы — свои для этого компьютера и для сетевого диска; работает набор текущего места хранения. */
  files: Record<StorageTarget, FileSet>
  /** Замки на путях от случайной правки. */
  locked: Record<FileKind, boolean>
  /** Лист Probe; пусто — лист текущего года. */
  sheet: string
  smb: SmbSettings
  projects: ProjectSettings[]
  /** Интервал проверки Consum, с (2–10). */
  intervalSec: number
  /** Пауза после изменения Consum, с (редактор дописывает файл). */
  settleSec: number
  /** Сколько дней хранить бэкапы. */
  backupDays: number
  rule: HeatRule
  openAtLogin: boolean
  /** Новый проект из Consum подключается сам. */
  autoProjects: boolean
  /** Закрытие окна прячет программу в трей / строку меню. */
  trayMinimize: boolean
  /** Запуск без окна: программа сразу в трее / строке меню. */
  startMinimized: boolean
  /** Не писать в файлы, открытые в Excel / ONLYOFFICE / LibreOffice (запись откладывается). */
  guardOpenFiles: boolean
}

/** Значения по умолчанию. */
export const DEFAULT_SETTINGS: AppSettings = {
  running: false,
  write: false,
  language: 'en',
  theme: 'system',
  target: 'local',
  files: { local: { consums: [''], sarjele: '', probe: '' }, smb: { consums: [''], sarjele: '', probe: '' } },
  locked: { consum: false, sarjele: false, probe: false },
  sheet: '',
  smb: { host: '', share: '', domain: '', username: '', password: '' },
  projects: [],
  intervalSec: 10,
  settleSec: 3,
  backupDays: 30,
  rule: 'latest',
  openAtLogin: false,
  autoProjects: true,
  trayMinimize: true,
  startMinimized: false,
  guardOpenFiles: true,
}

/** Проект с пустыми полями по умолчанию. */
export const createProject = (name: string, sheet: string, locked = true): ProjectSettings => ({ name, aliases: [], sheet, prefix: '', create: true, enabled: true, locked })

/** Разбирает один проект из сохранённых данных. */
function parseProject(raw: unknown): ProjectSettings | null {
  if (!isRecord(raw)) return null
  const name = readString(raw, 'name', '')
  if (!name) return null
  return {
    name,
    aliases: readArray(raw, 'aliases', (x): x is string => typeof x === 'string', []),
    sheet: readString(raw, 'sheet', ''),
    prefix: readString(raw, 'prefix', ''),
    create: readBoolean(raw, 'create', true),
    enabled: readBoolean(raw, 'enabled', true),
    locked: readBoolean(raw, 'locked', true),
  }
}

/** Разбирает набор файлов. */
function parseFileSet(raw: unknown): FileSet {
  const src = isRecord(raw) ? raw : {}
  const consums = readArray(src, 'consums', (x): x is string => typeof x === 'string', [''])
  return { consums: consums.length ? consums : [''], sarjele: readString(src, 'sarjele', ''), probe: readString(src, 'probe', '') }
}

/** Файлы текущего места хранения. */
export const activeFiles = (s: AppSettings): FileSet => s.files[s.target]

/** Разбирает сохранённые настройки поле за полем, подставляя значения по умолчанию. */
export function parseSettings(raw: unknown, defaults: AppSettings = DEFAULT_SETTINGS): AppSettings {
  const src = isRecord(raw) ? raw : {}
  const locked = isRecord(src.locked) ? src.locked : {}
  const smb = isRecord(src.smb) ? src.smb : {}
  const target = isOneOf(TARGETS)(src.target) ? src.target : defaults.target
  const files = isRecord(src.files) ? src.files : {}
  const parsed = { local: parseFileSet(files.local), smb: parseFileSet(files.smb) }
  // прежние версии хранили один набор (consums + paths) — он относится к месту хранения, выбранному тогда
  if (!isRecord(src.files) && (Array.isArray(src.consums) || isRecord(src.paths))) {
    parsed[target] = parseFileSet({ consums: src.consums, ...(isRecord(src.paths) ? src.paths : {}) })
  }
  return {
    running: readBoolean(src, 'running', defaults.running),
    write: readBoolean(src, 'write', defaults.write),
    language: isOneOf(LANGUAGES)(src.language) ? src.language : defaults.language,
    theme: isOneOf(THEMES)(src.theme) ? src.theme : defaults.theme,
    target,
    files: parsed,
    locked: {
      consum: readBoolean(locked, 'consum', defaults.locked.consum),
      sarjele: readBoolean(locked, 'sarjele', defaults.locked.sarjele),
      probe: readBoolean(locked, 'probe', defaults.locked.probe),
    },
    sheet: readString(src, 'sheet', defaults.sheet),
    smb: {
      host: readString(smb, 'host', ''),
      share: readString(smb, 'share', ''),
      domain: readString(smb, 'domain', ''),
      username: readString(smb, 'username', ''),
      password: readString(smb, 'password', ''),
    },
    projects: (Array.isArray(src.projects) ? src.projects : []).map(parseProject).filter((p): p is ProjectSettings => p !== null),
    intervalSec: Math.min(MAX_INTERVAL_SEC, Math.max(2, readNumber(src, 'intervalSec', defaults.intervalSec))),
    settleSec: Math.min(MAX_INTERVAL_SEC, Math.max(0, readNumber(src, 'settleSec', defaults.settleSec))),
    backupDays: Math.max(1, readNumber(src, 'backupDays', defaults.backupDays)),
    rule: isOneOf(RULES)(src.rule) ? src.rule : defaults.rule,
    openAtLogin: readBoolean(src, 'openAtLogin', defaults.openAtLogin),
    autoProjects: readBoolean(src, 'autoProjects', defaults.autoProjects),
    trayMinimize: readBoolean(src, 'trayMinimize', defaults.trayMinimize),
    startMinimized: readBoolean(src, 'startMinimized', defaults.startMinimized),
    guardOpenFiles: readBoolean(src, 'guardOpenFiles', defaults.guardOpenFiles),
  }
}

/** Частичное изменение настроек из окна: вложенные объекты сливаются, массивы заменяются целиком. */
export type SettingsPatch = { [K in keyof AppSettings]?: AppSettings[K] extends unknown[] ? AppSettings[K] : AppSettings[K] extends object ? Partial<AppSettings[K]> : AppSettings[K] }

/** Сливает изменение с настройками (вложенные объекты — по полям). */
export function mergeSettings(base: AppSettings, patch: SettingsPatch): AppSettings {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    const cur = (base as unknown as Record<string, unknown>)[k]
    out[k] = isRecord(v) && isRecord(cur) ? { ...cur, ...v } : v
  }
  return out as unknown as AppSettings
}
