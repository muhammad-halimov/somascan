/**
 * Параметры прогона движка: из командной строки и переменных окружения.
 *
 *   sync.mjs [--apply] [--migrate] [--scan] [--create-sheets] <Consum.xlsx> <Sarjele.xlsx> <Probe.xlsx>
 *   sync.mjs --restore [метка] <Sarjele.xlsx> <Probe.xlsx> [Consum.xlsx…]
 *
 * Окружение задаёт главный процесс (`host/EngineRunner`):
 *   PROJECTS_CFG   проекты программы (JSON: name, aliases, sheet, prefix, enabled, create)
 *   AUTO_PROJECTS  «0» — не подключать новые проекты из Consum сами
 *   ACTIVE_SOURCES имена Consum из «Хранилища» (JSON) — по ним ID переходят между месяцами
 *   PROBE_SHEETS   листы Probe через запятую (по умолчанию — текущий год, в январе — и прошлый)
 *   RULE           latest | oldest — с какой плавки брать металл
 *   BACKUP_DAYS    сколько дней хранить бэкапы
 *   LINKS          путь к links.json (ручные привязки)
 *   JSON_OUT       куда записать итог в JSON
 *   GUARD_OPEN_FILES «0» — писать и в файлы, открытые в редакторе
 */
import path from 'node:path'
import { isRecord, type HeatRule } from '@/shared/settings'

/** Проект в настройках движка. */
export interface EngineProject {
  name: string
  aliases: string[]
  sheet: string
  prefix: string
  enabled: boolean
  create: boolean
  /** Подключён движком сам (новый проект из Consum). */
  auto?: boolean
}

/** Что делает прогон. */
export type EngineCommand = 'sync' | 'scan' | 'create-sheets' | 'restore'

/** Параметры прогона. */
export interface EngineOptions {
  command: EngineCommand
  /** Записывать в файлы (иначе только план). */
  apply: boolean
  /** Только привязать существующие блоки, новых не создавать. */
  migrateOnly: boolean
  consum: string
  sarjele: string
  probe: string
  /** Для отката: метка и Consum. */
  restore: { stamp: string | null; consums: string[] } | null
  projects: EngineProject[]
  autoProjects: boolean
  /** Имена активных Consum или `null` (не задано). */
  activeSources: Set<string> | null
  /** Листы Probe и задан ли их список явно. */
  probeSheets: string[]
  probeSheetsExplicit: boolean
  year: number
  rule: HeatRule
  backupDays: number
  linksFile: string
  jsonOut: string | null
  guardOpenFiles: boolean
}

/** Флаги, которые не являются путями. */
const FLAGS = new Set(['--apply', '--migrate', '--create-sheets', '--scan'])

/** Разбирает проекты из PROJECTS_CFG. */
function parseProjects(raw: string | undefined): EngineProject[] {
  let list: unknown
  try {
    list = JSON.parse(raw || '[]')
  } catch {
    list = []
  }
  return (Array.isArray(list) ? list : []).filter(isRecord).map((p) => ({
    aliases: [],
    sheet: '',
    prefix: '',
    enabled: true,
    create: true,
    ...(p as Partial<EngineProject>),
    name: String(p.name ?? ''),
  }))
}

/** Разбирает JSON или возвращает `fallback`. */
function json<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Параметры из `argv` (без node и скрипта) и окружения. */
export function parseEngineOptions(argv: readonly string[], env: NodeJS.ProcessEnv, now = new Date()): EngineOptions {
  const year = now.getFullYear()
  const probeSheets = (env.PROBE_SHEETS || String(year)).split(',').map((x) => x.trim())
  const base = {
    apply: argv.includes('--apply'),
    migrateOnly: argv.includes('--migrate'),
    projects: parseProjects(env.PROJECTS_CFG),
    autoProjects: env.AUTO_PROJECTS !== '0',
    activeSources: env.ACTIVE_SOURCES ? new Set(json<string[]>(env.ACTIVE_SOURCES, [])) : null,
    probeSheets,
    probeSheetsExplicit: !!env.PROBE_SHEETS,
    year,
    rule: (env.RULE === 'oldest' ? 'oldest' : 'latest') as HeatRule,
    backupDays: Number(env.BACKUP_DAYS || 30),
    linksFile: env.LINKS || 'links.json',
    jsonOut: env.JSON_OUT || null,
    guardOpenFiles: env.GUARD_OPEN_FILES !== '0',
  }
  if (argv.includes('--restore')) {
    const pos = argv.filter((a) => !a.startsWith('--'))
    const stamp = /^(\d{4}-|before-restore)/.test(pos[0] ?? '') ? pos.shift()! : null
    const [sarjele = '', probe = '', ...consums] = pos
    return { ...base, command: 'restore', consum: '', sarjele, probe, restore: { stamp, consums } }
  }
  const [consum = '', sarjele = '', probe = ''] = argv.filter((a) => !FLAGS.has(a))
  const command: EngineCommand = argv.includes('--create-sheets') ? 'create-sheets' : argv.includes('--scan') ? 'scan' : 'sync'
  return { ...base, command, consum, sarjele, probe, restore: null }
}

/** Имя Consum-файла — источник для реестра ID. */
export const sourceName = (options: EngineOptions): string => path.basename(options.consum || '')
