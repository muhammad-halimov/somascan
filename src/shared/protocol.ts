/**
 * Протокол между окном и главным процессом (IPC), итог прогона движка и сведения для вкладки «Связи».
 *
 * Окно видит только `window.api` (см. `host/preload.ts`): все вызовы — `invoke` по именам из `IPC`,
 * события главного процесса — подписки `on*`. Тексты передаются кодами (`Message`), окно переводит их само.
 */
import type { Message } from './messages'
import type { AppSettings, FileKind, SettingsPatch } from './settings'

/** Каналы IPC. */
export const IPC = {
  init: 'init',
  setSettings: 'settings:set',
  start: 'start',
  stop: 'stop',
  pick: 'pick',
  check: 'check',
  scan: 'scan',
  setLink: 'links:set',
  createSheets: 'sheets:create',
  action: 'action',
  backups: 'backups',
  restore: 'restore',
  confirm: 'confirm',
  mountSmb: 'smb:mount',
  smbPassword: 'smb:password',
  driveSignIn: 'drive:signIn',
  driveSignOut: 'drive:signOut',
  clearJournal: 'journal:clear',
  open: 'open',
  // события
  journal: 'journal',
  navigate: 'navigate',
  run: 'run',
  settings: 'settings',
} as const

/** Уровень строки технического текста движка: по нему окно и `log.txt` её раскрашивают. */
export type TechLevel = 'info' | 'ok' | 'warn' | 'err' | 'plan'

/** Начало строки-сообщения в выводе движка: дальше — JSON `{ level, msg }` (см. `host/EngineRunner`). */
export const TECH_MARK = '@@msg '

/** Коды выхода движка. */
export const ENGINE_EXIT = {
  ok: 0,
  error: 1,
  /** Запись отложена: файл открыт в редакторе или занят другим прогоном. */
  deferred: 3,
} as const

// ── Прогоны ─────────────────────────────────────────────────────────────────

/** Что запустило прогон (подпись в журнале и в трее: `messages.trigger.*`). */
export type RunTrigger = 'first' | 'changed' | 'retry' | 'plan' | 'write' | 'migratePlan' | 'migrateWrite' | 'createSheets' | 'restore'

/** Состояние слежения и прогонов. */
export interface RunState {
  status: 'idle' | 'watching' | 'stopping'
  /** Что сейчас выполняется или `null`. */
  busy: RunTrigger | null
  nextCheckAt: number | null
  lastCheckAt: number | null
  lastRunAt: number | null
  /** Consum, запись в которые отложена (файлы открыты в редакторе): повторится при следующей проверке. */
  pending: string[]
}

/** Блок Sarjele в итоге прогона. */
export interface SummaryBlock {
  project: string
  element: string
  /** Новый блок, дозаполнение пустого или правка записанного (кг изменились). */
  mode: 'create' | 'fill' | 'update'
  /** Кг по плавкам (в правке — изменение, может быть меньше нуля). */
  kg: number
  heats: string[]
  /** Не хватило стали, кг. */
  missingKg: number
}

/** Действие с ID элемента. */
export interface SummaryId {
  id: string
  project: string
  element: string
  /** Привязан старый блок, создан новый, переименован, перешёл к этому Consum, ID дописывается в Consum. */
  action: 'linked' | 'created' | 'renamed' | 'adopted' | 'backfill'
}

/** Нехватка стали по Ø и форме. */
export interface SummaryShortage {
  dia: number | null
  form: string
  kg: number
  elements: string[]
  /** Свободно в открытых плавках. */
  free: number
  /** Числится в плавках, закрытых жёлтым. */
  closedLeft: number
}

/** Пропущенный элемент. */
export interface SummarySkip {
  project: string | null
  element: string
  reason: Message
}

/** Файл, запись в который отложена. */
export interface SummaryDeferred {
  file: string
  reason: Message
  /** Файл-замок редактора, по исчезновению которого запись повторится, или `null`. */
  lockFile: string | null
}

/** Итог одного прогона движка (`JSON_OUT`): из него окно строит карточку журнала. */
export interface RunSummary {
  command: 'sync' | 'create-sheets' | 'restore'
  /** Запуск с записью (`--apply`). */
  applied: boolean
  /** Файлы изменены. */
  wrote: boolean
  /** Месяц Consum («LUNA SEPTEMBRIE 2026») или пусто. */
  period: string
  /** Сколько прочитано: плавок (закрыто), блоков, строк Consum с расходом. */
  counts: { heats: number; closedHeats: number; blocks: number; rows: number }
  blocks: SummaryBlock[]
  ids: SummaryId[]
  /** Плавки на закраску жёлтым / снятие жёлтого. */
  closed: string[]
  reopened: string[]
  shortages: SummaryShortage[]
  skipped: SummarySkip[]
  /** Проекты Consum, которые не настроены. */
  unconfigured: string[]
  /** Листы Sarjele, которые создаются. */
  sheets: string[]
  /** Старые незакрытые плавки, пропущенные правилом «с последней использованной». */
  oldHeats: Array<{ dia: string; form: string; heats: string[] }>
  notes: Message[]
  warnings: Message[]
  deferred: SummaryDeferred[]
  /** Метка бэкапа. */
  backup: string | null
  /** Проверка после записи: `true` — совпало, `false` — расхождения (`problems`), `null` — не проверялось. */
  verified: boolean | null
  problems: Message[]
  /** Откат: к какой метке и под какой меткой сохранено состояние до отката. */
  restored: { stamp: string; savedAs: string } | null
  /** Ошибка, из-за которой прогон не завершился. */
  error: Message | null
  /** «время:размер» Consum после записи ID программой: слежение не принимает свою запись за изменение. */
  consumAfter: string | null
}

/** Пустой итог. */
export const emptySummary = (command: RunSummary['command'], applied: boolean): RunSummary => ({
  command,
  applied,
  wrote: false,
  period: '',
  counts: { heats: 0, closedHeats: 0, blocks: 0, rows: 0 },
  blocks: [],
  ids: [],
  closed: [],
  reopened: [],
  shortages: [],
  skipped: [],
  unconfigured: [],
  sheets: [],
  oldHeats: [],
  notes: [],
  warnings: [],
  deferred: [],
  backup: null,
  verified: null,
  problems: [],
  restored: null,
  error: null,
  consumAfter: null,
})

// ── Журнал ──────────────────────────────────────────────────────────────────

/** Уровень записи журнала. */
export type JournalLevel = 'info' | 'ok' | 'warn' | 'err'

/** Строка технического вывода движка («Подробно»). `plan` — блок плана, `head` — заголовок. */
export interface TechLine {
  level: JournalLevel | 'plan' | 'head'
  /** Сообщение движка: окно переводит его на язык интерфейса. */
  msg?: Message
  /** Строка без перевода (стек ошибки, метки копий, вывод сторонних библиотек). */
  text?: string
}

/** Событие программы: слежение, файлы, ошибки. */
export interface JournalEvent {
  kind: 'event'
  id: number
  t: number
  level: JournalLevel
  msg: Message
}

/** Итог прогона: выполняется, готов, отложен или с ошибкой. */
export type RunOutcome = 'running' | 'wrote' | 'planned' | 'nothing' | 'deferred' | 'failed'

/** Прогон движка. */
export interface JournalRun {
  kind: 'run'
  id: number
  t: number
  trigger: RunTrigger
  /** Consum прогона (имя файла) или `null`. */
  file: string | null
  apply: boolean
  outcome: RunOutcome
  finishedAt: number | null
  summary: RunSummary | null
  /** Технический вывод движка. */
  lines: TechLine[]
}

/** Запись журнала. */
export type JournalEntry = JournalEvent | JournalRun

/** Итог прогона по его данным. */
export function runOutcome(summary: RunSummary | null, code: number): RunOutcome {
  if (code === ENGINE_EXIT.deferred) return 'deferred'
  if (code !== ENGINE_EXIT.ok || summary?.error) return 'failed'
  if (!summary) return 'nothing'
  if (summary.wrote) return 'wrote'
  if (summary.command === 'restore') return summary.restored ? 'wrote' : 'nothing'
  if (summary.applied) return 'nothing'
  return summary.blocks.length || summary.ids.length || summary.closed.length || summary.reopened.length || summary.sheets.length ? 'planned' : 'nothing'
}

// ── Хранилище и «Связи» ─────────────────────────────────────────────────────

/** Итог проверки файла на вкладке «Хранилище». */
export interface CheckResult {
  ok: boolean
  msg: Message
  sheets?: string[]
}

/** Кандидат-блок в Sarjele для привязки элемента. */
export interface Candidate {
  sheet: string
  title: string
  row: number
  filled: boolean
  score: number
}

/** Как элемент Consum связан с блоком Sarjele. */
export type LinkKind = 'known' | 'migrate' | 'new' | 'skip'
/** По чему найдена связь. */
export type LinkVia = 'id' | 'registry' | 'link' | 'name' | 'new'

/** Элемент Consum и состояние его привязки к блоку Sarjele. */
export interface ScanElement {
  source: string
  project: string
  rawProject: string | null
  row: number
  name: string
  buc: unknown
  id: string
  kind: LinkKind
  via: LinkVia | null
  why: Message | null
  sheet: string | null
  newSheet: boolean
  block: { sheet: string; title: string; row: number } | null
  changed: boolean
  link: string | null
  candidates: Candidate[]
}

/** Проект, найденный в Consum. */
export interface ScanProject {
  raw: string
  rows: number
  sources?: string[]
  /** Проект программы: настроенный (`exact` / `auto` — по написанию) или подключённый движком сам (`adopted`). */
  matched: { name: string; how: 'exact' | 'auto' | 'adopted'; sheet: string; sheetExists: boolean } | null
  suggestProject: string | null
  suggestSheet: string | null
}

/** Что движок прочитал для вкладки «Связи» (одного Consum); при ошибке — только `error`. */
export interface EngineScan {
  error?: Message
  source: string
  elements: ScanElement[]
  projects: ScanProject[]
  sheets: Array<{ name: string; blocks: number; unlinked: number }>
  orphans: Array<{ sheet: string; title: string; row: number }>
  registry: number
}

/** Сведения для вкладки «Связи» по всем Consum. */
export interface ScanData extends Omit<EngineScan, 'source'> {
  error?: Message
  files: string[]
  links: Record<string, string>
}

// ── Окно ────────────────────────────────────────────────────────────────────

/** Действия на вкладке «Расширенные». */
export type ActionName = 'plan' | 'write' | 'migrate-plan' | 'migrate-write'

/** Что можно открыть в Finder / Проводнике. */
export type OpenTarget = 'log' | 'links'

/** Вкладки окна. */
export type TabId = 'home' | 'storage' | 'links' | 'advanced'

/** Первые данные окна. */
export interface InitData {
  settings: AppSettings
  run: RunState
  journal: JournalEntry[]
  version: string
  year: number
  /** Платформа главного процесса (`darwin`, `win32`, `linux`). */
  platform: string
}

/** Итог действия, которое может не удаться. */
export interface ActionResult {
  ok: boolean
  error?: Message
}

/** API главного процесса, доступный окну (`window.api`). */
export interface Api {
  init(): Promise<InitData>
  setSettings(patch: SettingsPatch): Promise<AppSettings>
  start(): Promise<ActionResult>
  stop(): Promise<void>
  pick(kind: FileKind, current?: string): Promise<string | null>
  check(kind: FileKind, file?: string): Promise<CheckResult>
  scan(): Promise<ScanData>
  setLink(key: string, value: string | null): Promise<Record<string, string>>
  createSheets(): Promise<ActionResult>
  action(name: ActionName): Promise<ActionResult>
  backups(): Promise<string[]>
  restore(stamp: string): Promise<ActionResult>
  confirm(options: { title: string; message: string; ok?: string; cancel?: string }): Promise<boolean>
  mountSmb(): Promise<ActionResult>
  /** Сохранённый пароль сетевого диска (по нажатию на «глазок»). */
  smbPassword(): Promise<string>
  /** Вход в Google в браузере системы (доступ к Drive); почта аккаунта приходит в настройках. */
  driveSignIn(): Promise<ActionResult>
  /** Выход из Google: доступ отзывается, папка и имена файлов остаются. */
  driveSignOut(): Promise<void>
  clearJournal(): Promise<void>
  open(what: OpenTarget): Promise<void>
  onJournal(cb: (entry: JournalEntry) => void): () => void
  onNavigate(cb: (tab: TabId) => void): () => void
  onRun(cb: (run: RunState) => void): () => void
  onSettings(cb: (settings: AppSettings) => void): () => void
}
