/**
 * Движок синхронизации: одна команда за запуск.
 *
 *   sync           прочитать файлы, построить план, напечатать его, с `--apply` — записать (`SyncWriter`)
 *   scan           связи элементов с блоками для вкладки «Связи» → JSON_OUT
 *   create-sheets  создать недостающие листы проектов в Sarjele
 *   restore        откатить файлы к бэкапу
 *   bridge         перенести бирки с телефонов из копии Probe в Google Drive в Probe (`ProbeBridge`)
 *
 * Итог прогона (`RunSummary`) пишется в JSON_OUT и при ошибке. Код выхода: 0 — готово, 1 — ошибка,
 * 3 — запись отложена (файл открыт в редакторе или занят другим прогоном).
 */
import fs from 'node:fs'
import ExcelJS from 'exceljs'
import { message, MessageError } from '@/shared/messages'
import { ENGINE_EXIT, type RunSummary } from '@/shared/protocol'
import { SarjeleWriter } from './books/SarjeleWriter'
import type { EngineOptions } from './EngineOptions'
import { Backups } from './FileGuard'
import { hasChanges, Planner } from './planning/Planner'
import { ProbeBridge } from './ProbeBridge'
import { consoleSink, RunReport, type TextSink } from './RunReport'
import { SafeSave, SyncWriter } from './SyncWriter'
import { Workspace } from './Workspace'

/** Версия движка: подставляет сборка (`vite.engine.config.ts`), в проверках не определена. */
declare const __ENGINE_VERSION__: string | undefined
export const ENGINE_VERSION: string = typeof __ENGINE_VERSION__ === 'string' ? __ENGINE_VERSION__ : 'dev'

/** Выполняет одну команду движка. */
export class SyncEngine {
  private readonly options: EngineOptions
  private readonly out: TextSink
  /** Метка прогона (бэкапы). */
  private readonly stamp: string

  constructor(options: EngineOptions, out: TextSink = consoleSink, now = new Date()) {
    this.options = options
    this.out = out
    this.stamp = Backups.stamp(now)
  }

  /** @returns Код выхода процесса. */
  async run(): Promise<number> {
    const { options } = this
    if (options.command === 'scan') {
      if (!this.filesGiven()) return ENGINE_EXIT.error
      try {
        const ws = await Workspace.load(options, new RunReport(this.out, 'sync', false))
        this.writeJson(ws.scan())
        return ENGINE_EXIT.ok
      } catch (e) {
        if (!(e instanceof MessageError)) throw e
        this.out.msg('err', e.msg, 'err')
        this.writeJson({ error: e.msg })
        return ENGINE_EXIT.error
      }
    }
    const command: RunSummary['command'] = options.command === 'restore' || options.command === 'create-sheets' || options.command === 'bridge' ? options.command : 'sync'
    const report = new RunReport(this.out, command, options.apply)
    try {
      if (command === 'restore') return this.restore(report)
      if (command === 'bridge') return await this.bridge(report)
      if (!this.filesGiven()) {
        report.summary.error = message('error.usage')
        return ENGINE_EXIT.error
      }
      return command === 'create-sheets' ? await this.createSheets(report) : await this.sync(report)
    } catch (e) {
      // ошибка прогона: итог с причиной уходит в окно, стек — в технический журнал
      if (e instanceof MessageError) report.fail(e.msg)
      else {
        report.summary.error = message('error.other', { error: (e as Error).message ?? String(e) })
        this.out.warn((e as Error).stack ?? String(e))
      }
      return ENGINE_EXIT.error
    } finally {
      this.writeJson(report.summary)
    }
  }

  /** Заданы ли все три файла. */
  private filesGiven(): boolean {
    const { consum, sarjele, probe } = this.options
    if (consum && sarjele && probe) return true
    this.out.msg('err', message('tech.usage'), 'err')
    return false
  }

  /** Записывает JSON итога, если путь задан. */
  private writeJson(data: unknown): void {
    if (this.options.jsonOut) fs.writeFileSync(this.options.jsonOut, JSON.stringify(data))
  }

  /** Синхронизация: план и (с `--apply`) запись. */
  private async sync(report: RunReport): Promise<number> {
    const { options } = this
    report.say('tech.engine', { version: ENGINE_VERSION })
    const ws = await Workspace.load(options, report)
    report.overview(ws)
    const planner = new Planner(ws)
    const result = planner.build()
    report.plan(ws, result)
    if (!options.apply) {
      report.line()
      report.say('tech.dryRun')
      return ENGINE_EXIT.ok
    }
    const changes = planner.changes(result)
    if (!hasChanges(changes)) return ENGINE_EXIT.ok
    const outcome = await new SyncWriter(ws, report, this.stamp).write(result, changes)
    report.summary.wrote = outcome.wrote
    report.summary.consumAfter = outcome.consumAfter
    report.summary.deferred = outcome.deferred
    report.summary.problems = outcome.problems ?? []
    report.summary.verified = outcome.problems ? outcome.problems.length === 0 : null
    return outcome.deferred.length ? ENGINE_EXIT.deferred : ENGINE_EXIT.ok
  }

  /** Бирки с телефонов из копии Probe в Probe (`--bridge [--apply] <копия> <Probe>`). */
  private async bridge(report: RunReport): Promise<number> {
    const { options } = this
    if (!options.copy || !options.probe) {
      report.summary.error = message('error.bridgeUsage')
      return ENGINE_EXIT.error
    }
    report.say('tech.engine', { version: ENGINE_VERSION })
    return new ProbeBridge(options, report, this.stamp).run()
  }

  /** Создаёт недостающие листы проектов (`--create-sheets [--apply]`). */
  private async createSheets(report: RunReport): Promise<number> {
    const { options } = this
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(options.sarjele)
    const present = wb.worksheets.map((w) => w.name)
    const missing = [...new Set(options.projects.filter((p) => p.enabled !== false && p.sheet && p.create && !present.includes(p.sheet)).map((p) => p.sheet))]
    if (!missing.length) {
      report.say('tech.sheetsPresent', undefined, 'ok')
      return ENGINE_EXIT.ok
    }
    report.summary.sheets = missing
    report.say('tech.sheetsMissing', { sheets: missing.map((x) => `«${x}»`).join(', ') })
    if (!options.apply) {
      report.line()
      report.say('tech.dryRunCreate')
      return ENGINE_EXIT.ok
    }
    new Backups(options.backupDays).save([options.sarjele], this.stamp)
    report.summary.backup = this.stamp
    report.say('tech.backup', { stamp: this.stamp, files: `"${options.sarjele}"` }, 'ok')
    new SarjeleWriter(wb, { heats: new Map(), journal: new Set() }).createSheets(missing, (name) => report.say('tech.sheetCreated', { name }, 'ok'))
    for (const n of await SafeSave.lockedWorkbook(options.sarjele, wb)) report.note(n)
    report.summary.wrote = true
    return ENGINE_EXIT.ok
  }

  /** Откат к бэкапу (`--restore [метка] …`); без метки — список меток. */
  private restore(report: RunReport): number {
    const { options } = this
    const { stamp, consums } = options.restore!
    if (!stamp) {
      const stamps = Backups.stamps(options.sarjele)
      report.say('tech.backupsTitle', { list: stamps.length ? '' : message('tech.none') })
      for (const s of stamps) report.line(`  ${s}`)
      return ENGINE_EXIT.ok
    }
    try {
      const r = Backups.restore(stamp, options.sarjele, options.probe, consums)
      report.summary.restored = { stamp, savedAs: r.savedAs }
      report.summary.wrote = true
      report.say('tech.restored', { stamp, savedAs: r.savedAs }, 'ok')
      return ENGINE_EXIT.ok
    } catch (e) {
      if (!(e instanceof MessageError)) throw e
      report.fail(e.msg)
      return ENGINE_EXIT.error
    }
  }
}
