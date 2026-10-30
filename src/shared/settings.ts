/**
 * Настройки приложения: строение, значения по умолчанию и разбор сохранённого файла.
 *
 * Хранит их главный процесс (`host/SettingsStore`) в `userData/state.json`; окно получает копию
 * без пароля сетевого диска и без ключа доступа к Google Drive. Каждое поле разбирается отдельно: одно испорченное поле не сбрасывает остальные.
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
export const TARGETS = ['local', 'smb', 'googleDrive'] as const
/** Где лежат таблицы: на этом компьютере, на сетевом диске или в Google Drive. */
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

/**
 * Google Drive: вошедший аккаунт, папка таблиц (ссылка или id; пусто — «Мой диск») и ключ доступа.
 * Ключ (refresh-токен) хранится зашифрованным, как пароль сетевого диска, и в окно не отдаётся.
 */
export interface GoogleDriveSettings {
  /** Почта вошедшего аккаунта; пусто — вход не выполнен. */
  account: string
  folder: string
  token: string
}

/**
 * «Звонок» телефонов через Firebase Firestore (мост с телефонами, `host/PhoneBridge`): телефон после записи в копию
 * Probe обновляет документ канала, окно слушает его, и перенос идёт сразу, а не при проверке копии.
 */
export interface FirestoreSettings {
  enabled: boolean
  /** ID проекта Firebase. */
  projectId: string
  /** Ключ Web API проекта Firebase (не секрет: доступ задают правила Firestore). */
  apiKey: string
}

/** Файлы одного места хранения (в Google Drive — имена файлов в папке). */
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
  /** Файлы — свои у каждого места хранения; работает набор текущего. */
  files: Record<StorageTarget, FileSet>
  /** Замки на путях (и на папке Google Drive) от случайной правки. */
  locked: Record<FileKind | 'folder', boolean>
  /** Лист Probe; пусто — лист текущего года. */
  sheet: string
  smb: SmbSettings
  googleDrive: GoogleDriveSettings
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
  /**
   * Мост с телефонами: телефоны пишут бирки в копию Probe в Google Drive (папка и имя файла — как у места хранения
   * Google Drive), программа переносит их в Probe (`host/PhoneBridge`). Только когда таблицы не в Google Drive.
   */
  bridge: boolean
  /** «Звонок» телефонов через Firestore (под замком в «Телефонах»). */
  firestore: FirestoreSettings
}

/** Значения по умолчанию. */
export const DEFAULT_SETTINGS: AppSettings = {
  running: false,
  write: false,
  language: 'en',
  theme: 'system',
  target: 'local',
  files: {
    local: { consums: [''], sarjele: '', probe: '' },
    smb: { consums: [''], sarjele: '', probe: '' },
    googleDrive: { consums: [''], sarjele: 'Sarjele din elemente.xlsx', probe: 'Probe otel.xlsx' },
  },
  locked: { consum: false, sarjele: false, probe: false, folder: false },
  sheet: '',
  smb: { host: '', share: '', domain: '', username: '', password: '' },
  googleDrive: { account: '', folder: '', token: '' },
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
  bridge: false,
  firestore: { enabled: false, projectId: '', apiKey: '' },
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

/** Разбирает набор файлов (нет его — `fallback`). */
function parseFileSet(raw: unknown, fallback: FileSet = { consums: [''], sarjele: '', probe: '' }): FileSet {
  if (!isRecord(raw)) return { ...fallback, consums: [...fallback.consums] }
  const consums = readArray(raw, 'consums', (x): x is string => typeof x === 'string', [''])
  return { consums: consums.length ? consums : [''], sarjele: readString(raw, 'sarjele', ''), probe: readString(raw, 'probe', '') }
}

/** Файлы текущего места хранения. */
export const activeFiles = (s: AppSettings): FileSet => s.files[s.target]

/** Разбирает сохранённые настройки поле за полем, подставляя значения по умолчанию. */
export function parseSettings(raw: unknown, defaults: AppSettings = DEFAULT_SETTINGS): AppSettings {
  const src = isRecord(raw) ? raw : {}
  const locked = isRecord(src.locked) ? src.locked : {}
  const smb = isRecord(src.smb) ? src.smb : {}
  const drive = isRecord(src.googleDrive) ? src.googleDrive : {}
  const firestore = isRecord(src.firestore) ? src.firestore : {}
  const target = isOneOf(TARGETS)(src.target) ? src.target : defaults.target
  const files = isRecord(src.files) ? src.files : {}
  const parsed = { local: parseFileSet(files.local), smb: parseFileSet(files.smb), googleDrive: parseFileSet(files.googleDrive, defaults.files.googleDrive) }
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
      folder: readBoolean(locked, 'folder', defaults.locked.folder),
    },
    sheet: readString(src, 'sheet', defaults.sheet),
    smb: {
      host: readString(smb, 'host', ''),
      share: readString(smb, 'share', ''),
      domain: readString(smb, 'domain', ''),
      username: readString(smb, 'username', ''),
      password: readString(smb, 'password', ''),
    },
    googleDrive: {
      account: readString(drive, 'account', ''),
      folder: readString(drive, 'folder', ''),
      token: readString(drive, 'token', ''),
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
    bridge: readBoolean(src, 'bridge', defaults.bridge),
    firestore: {
      enabled: readBoolean(firestore, 'enabled', defaults.firestore.enabled),
      projectId: readString(firestore, 'projectId', defaults.firestore.projectId).trim(),
      apiKey: readString(firestore, 'apiKey', defaults.firestore.apiKey).trim(),
    },
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
