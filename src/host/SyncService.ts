/**
 * Прогоны движка из программы (синхронизация, создание листов, откат) и их состояние для окна и трея.
 *
 * Одновременно — только один прогон (`busy`): два движка, пишущие в одни файлы, испортили бы их.
 * Каждый прогон — запись журнала: движок пишет итог в JSON (`JSON_OUT`), технический вывод идёт в «Подробно».
 * Код выхода 3 — запись отложена (файл открыт в редакторе): Consum попадает в `pending`,
 * и `ConsumWatcher` повторит прогон, когда файлы закроют.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Backups } from '@/engine/FileGuard'
import { Store } from '@/shared/Store'
import { message, triggerMessage, type Message } from '@/shared/messages'
import { ENGINE_EXIT, runOutcome, type ActionResult, type RunState, type RunSummary, type RunTrigger } from '@/shared/protocol'
import type { EngineRunner } from './EngineRunner'
import type { Journal } from './Journal'
import type { SettingsStore } from './SettingsStore'

/** Сколько меток бэкапов показывать. */
const MAX_STAMPS = 40

/** Начальное состояние. */
const IDLE: RunState = { status: 'idle', busy: null, nextCheckAt: null, lastCheckAt: null, lastRunAt: null, pending: [] }

/** Параметры прогона синхронизации. */
export interface SyncRequest {
  apply: boolean
  /** Только привязать ID (`--migrate`). */
  migrate?: boolean
  trigger: RunTrigger
  /** Только эти Consum (по умолчанию — все). */
  only?: string[]
}

/** Прогоны движка и их состояние. */
export class SyncService extends Store<RunState> {
  /** Consum, которые программа сама записала (ID): путь → «время:размер» после записи. */
  readonly ownWrites = new Map<string, string>()
  private readonly settings: SettingsStore
  private readonly journal: Journal
  private readonly runner: EngineRunner

  constructor(settings: SettingsStore, journal: Journal, runner: EngineRunner) {
    super(IDLE)
    this.settings = settings
    this.journal = journal
    this.runner = runner
  }

  /** Меняет поля состояния. */
  patch(patch: Partial<RunState>): void {
    this.setState((s) => ({ ...s, ...patch }))
  }

  /** Почему прогон невозможен (не найдены файлы) или `null`. */
  pathsProblem(): Message | null {
    const f = this.settings.files()
    const consums = this.settings.consumFiles()
    const bad: string[] = []
    if (!consums.length) bad.push('Consum')
    for (const c of consums) if (!fs.existsSync(c)) bad.push(`Consum «${path.basename(c)}»`)
    if (!f.sarjele || !fs.existsSync(f.sarjele)) bad.push('Sarjele')
    if (!f.probe || !fs.existsSync(f.probe)) bad.push('Probe')
    return bad.length ? message('event.missingFiles', { files: bad.join(', ') }) : null
  }

  /** Метки бэкапов рядом с Sarjele, новые сверху. */
  backups(): string[] {
    const file = this.settings.files().sarjele
    return file ? Backups.stamps(file, MAX_STAMPS) : []
  }

  /** Один прогон синхронизации по каждому Consum. */
  async syncOnce({ apply, migrate = false, trigger, only }: SyncRequest): Promise<ActionResult> {
    return this.exclusive(trigger, async () => {
      const s = this.settings.files()
      const pending = new Set(this.getSnapshot().pending)
      let ok = true
      for (const consum of only ?? this.settings.consumFiles()) {
        const { code, summary } = await this.engine(trigger, path.basename(consum), apply, [...(migrate ? ['--migrate'] : []), consum, s.sarjele, s.probe, ...(apply ? ['--apply'] : [])])
        if (summary?.consumAfter) this.ownWrites.set(consum, summary.consumAfter)
        if (code === ENGINE_EXIT.deferred) pending.add(consum)
        else {
          pending.delete(consum)
          if (code !== ENGINE_EXIT.ok) ok = false
        }
      }
      this.patch({ lastRunAt: Date.now(), pending: [...pending] })
      return ok
    })
  }

  /** Создаёт недостающие листы проектов в Sarjele. */
  createSheets(): Promise<ActionResult> {
    return this.exclusive('createSheets', async () => {
      const s = this.settings.files()
      const { code } = await this.engine('createSheets', null, true, ['--create-sheets', '--apply', this.settings.consumFiles()[0]!, s.sarjele, s.probe])
      return code === ENGINE_EXIT.ok
    })
  }

  /** Откатывает файлы к бэкапу. */
  restore(stamp: string): Promise<ActionResult> {
    return this.exclusive('restore', async () => {
      const s = this.settings.files()
      const { code } = await this.engine('restore', null, true, ['--restore', stamp, s.sarjele, s.probe, ...this.settings.consumFiles()])
      return code === ENGINE_EXIT.ok
    })
  }

  /** Выполняет `fn` как единственный прогон. */
  private async exclusive(trigger: RunTrigger, fn: () => Promise<boolean>): Promise<ActionResult> {
    const bad = this.pathsProblem()
    if (bad) {
      this.journal.event('err', bad)
      return { ok: false, error: bad }
    }
    const busy = this.getSnapshot().busy
    if (busy) {
      const error = message('event.busy', { what: triggerMessage(busy) })
      this.journal.event('warn', error)
      return { ok: false, error }
    }
    this.patch({ busy: trigger })
    try {
      return { ok: await fn() }
    } finally {
      this.patch({ busy: null })
    }
  }

  /** Один запуск движка как прогон журнала: итог из `JSON_OUT`, технический вывод — в прогон. */
  private async engine(trigger: RunTrigger, file: string | null, apply: boolean, args: string[]): Promise<{ code: number; summary: RunSummary | null }> {
    const run = this.journal.beginRun(trigger, file, apply)
    const out = path.join(os.tmpdir(), `somasync-run-${process.pid}-${run.id}.json`)
    const { code, err } = await this.runner.run(args, { JSON_OUT: out }, run)
    let summary: RunSummary | null = null
    try {
      summary = JSON.parse(fs.readFileSync(out, 'utf8')) as RunSummary
      fs.unlinkSync(out)
    } catch {
      // движок упал до записи итога
    }
    if (code !== ENGINE_EXIT.ok && code !== ENGINE_EXIT.deferred && summary && !summary.error) {
      summary.error = message('event.engineExit', { code })
    }
    if (!summary && code !== ENGINE_EXIT.ok) {
      const last = err.split('\n').map((l) => l.trim()).filter(Boolean).pop()
      this.journal.event('err', last ? message('error.other', { error: last }) : message('event.engineExit', { code }))
    }
    this.journal.finishRun(run, runOutcome(summary, code), summary)
    return { code, summary }
  }
}
