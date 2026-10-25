/**
 * Движок синхронизации: одна команда за запуск.
 *
 *   sync           прочитать файлы, построить план, напечатать его, с `--apply` — записать (`SyncWriter`)
 *   scan           связи элементов с блоками для вкладки «Связи» → JSON_OUT
 *   create-sheets  создать недостающие листы проектов в Sarjele
 *   restore        откатить файлы к бэкапу
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
        this.out.warn(e.message)
        this.writeJson({ error: e.msg })
        return ENGINE_EXIT.error
      }
    }
    const command: RunSummary['command'] = options.command === 'restore' ? 'restore' : options.command === 'create-sheets' ? 'create-sheets' : 'sync'
    const report = new RunReport(this.out, command, options.apply)
    try {
      if (command === 'restore') return this.restore(report)
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
    this.out.warn('Использование: node sync.mjs "<Consum.xlsx>" "<Sarjele.xlsx>" "<Probe.xlsx>" [--apply]')
    return false
  }

  /** Записывает JSON итога, если путь задан. */
  private writeJson(data: unknown): void {
    if (this.options.jsonOut) fs.writeFileSync(this.options.jsonOut, JSON.stringify(data))
  }

  /** Синхронизация: план и (с `--apply`) запись. */
  private async sync(report: RunReport): Promise<number> {
    const { options } = this
    report.line(`Движок Somasync ${ENGINE_VERSION}`)
    const ws = await Workspace.load(options, report)
    report.overview(ws)
    const planner = new Planner(ws)
    const result = planner.build()
    report.plan(ws, result)
    if (!options.apply) {
      report.line('\n(dry-run: ничего не записано; для записи добавь --apply)')
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

  /** Создаёт недостающие листы проектов (`--create-sheets [--apply]`). */
  private async createSheets(report: RunReport): Promise<number> {
    const { options } = this
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(options.sarjele)
    const present = wb.worksheets.map((w) => w.name)
    const missing = [...new Set(options.projects.filter((p) => p.enabled !== false && p.sheet && p.create && !present.includes(p.sheet)).map((p) => p.sheet))]
    if (!missing.length) {
      report.line('Все листы проектов уже есть в Sarjele.')
      return ENGINE_EXIT.ok
    }
    report.summary.sheets = missing
    report.line(`Листы, которых нет в Sarjele: ${missing.map((x) => `«${x}»`).join(', ')}`)
    if (!options.apply) {
      report.line('\n(dry-run: ничего не записано; для создания добавь --apply)')
      return ENGINE_EXIT.ok
    }
    new Backups(options.backupDays).save([options.sarjele], this.stamp)
    report.summary.backup = this.stamp
    report.line(`Бэкап: ${this.stamp}   (откат: node sync.mjs --restore ${this.stamp} "${options.sarjele}")`)
    new SarjeleWriter(wb, { heats: new Map(), journal: new Set() }).createSheets(missing, (name) => report.line(`✔ создан лист «${name}»`))
    for (const n of await SafeSave.lockedWorkbook(options.sarjele, wb)) report.note(n)
    report.summary.wrote = true
    return ENGINE_EXIT.ok
  }

  /** Откат к бэкапу (`--restore [метка] …`); без метки — список меток. */
  private restore(report: RunReport): number {
    const { options } = this
    const { stamp, consums } = options.restore!
    if (!stamp) {
      report.line('Доступные копии (новые сверху):\n  ' + (Backups.stamps(options.sarjele).join('\n  ') || 'нет'))
      return ENGINE_EXIT.ok
    }
    try {
      const r = Backups.restore(stamp, options.sarjele, options.probe, consums)
      report.summary.restored = { stamp, savedAs: r.savedAs }
      report.summary.wrote = true
      report.line(`Восстановлено состояние ${stamp}. Текущее перед откатом сохранено как ${r.savedAs}.`)
      return ENGINE_EXIT.ok
    } catch (e) {
      if (!(e instanceof MessageError)) throw e
      report.fail(e.msg)
      return ENGINE_EXIT.error
    }
  }
}
