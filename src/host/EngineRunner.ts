/**
 * Запуск движка дочерним процессом: тот же бинарь Electron в режиме Node (`ELECTRON_RUN_AS_NODE`).
 *
 * Настройки передаются окружением (см. `engine/EngineOptions`), технический вывод идёт в прогон журнала:
 * строки-сообщения движка (`TECH_MARK` + JSON) — кодом, их переводит окно; прочие строки — как есть.
 * Одновременно работает не больше одного прогона записи — за этим следит `SyncService`.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { message, type Message } from '@/shared/messages'
import { TECH_MARK, type JournalRun, type TechLevel } from '@/shared/protocol'
import type { AppPaths } from './AppPaths'
import { Journal } from './Journal'
import type { SettingsStore } from './SettingsStore'

/** Итог запуска. */
export interface EngineResult {
  /** Код выхода (−1 — не запустился). */
  code: number
  /** stderr. */
  err: string
}

/** Запускает движок. */
export class EngineRunner {
  private readonly paths: AppPaths
  private readonly settings: SettingsStore
  private readonly journal: Journal
  /** Прогоны, которые ещё идут. */
  private readonly running = new Set<ChildProcess>()

  constructor(paths: AppPaths, settings: SettingsStore, journal: Journal) {
    this.paths = paths
    this.settings = settings
    this.journal = journal
  }

  /** Идёт ли прогон (выход из программы его дожидается). */
  get active(): boolean {
    return this.running.size > 0
  }

  /** Окружение движка из настроек. */
  private env(extra: Record<string, string>): NodeJS.ProcessEnv {
    const s = this.settings.getSnapshot()
    const projects = s.projects
      .filter((p) => p.name.trim())
      .map((p) => ({ ...p, name: p.name.trim(), sheet: (p.sheet || '').trim(), aliases: (p.aliases || []).map((a) => a.trim()).filter(Boolean) }))
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PROJECTS_CFG: JSON.stringify(projects),
      AUTO_PROJECTS: s.autoProjects === false ? '0' : '1',
      ACTIVE_SOURCES: JSON.stringify(this.settings.consumFiles().map((f) => path.basename(f))),
      BACKUP_DAYS: String(s.backupDays),
      RULE: s.rule,
      LINKS: this.paths.linksFile,
      GUARD_OPEN_FILES: s.guardOpenFiles ? '1' : '0',
      ...extra,
    }
    if (s.sheet) env.PROBE_SHEETS = s.sheet
    return env
  }

  /**
   * Запускает `sync.mjs` и ждёт завершения.
   * @param run Прогон журнала, куда идёт технический вывод (без него вывод не сохраняется).
   */
  run(args: readonly string[], env: Record<string, string> = {}, run?: JournalRun): Promise<EngineResult> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(this.paths.engine, 'sync.mjs'), ...args], { env: this.env(env), cwd: this.paths.data, windowsHide: true })
      this.running.add(child)
      let err = ''
      const buffers = { out: '', err: '' }
      const emit = (line: string, isErr: boolean) => {
        if (!run || !line.trim()) return
        if (line.startsWith(TECH_MARK)) {
          try {
            const { level, msg } = JSON.parse(line.slice(TECH_MARK.length)) as { level: TechLevel; msg: Message }
            this.journal.runMessage(run, level, msg)
            return
          } catch {
            // не разобралось — строкой как есть
          }
        }
        this.journal.runLine(run, isErr ? Journal.classifyStderr(line) : Journal.classify(line), line.replace(/\s+$/, ''))
      }
      const feed = (chunk: Buffer, isErr: boolean) => {
        const text = chunk.toString()
        if (isErr) err += text
        const key = isErr ? 'err' : 'out'
        const lines = (buffers[key] + text).split('\n')
        buffers[key] = lines.pop() ?? ''
        for (const l of lines) emit(l, isErr)
      }
      child.stdout?.on('data', (c: Buffer) => feed(c, false))
      child.stderr?.on('data', (c: Buffer) => feed(c, true))
      child.on('error', (e) => {
        this.journal.event('err', message('event.engineNotStarted', { error: e.message }))
        this.running.delete(child)
        resolve({ code: -1, err })
      })
      child.on('close', (code) => {
        emit(buffers.out, false)
        emit(buffers.err, true)
        this.running.delete(child)
        resolve({ code: code ?? -1, err })
      })
    })
  }
}
