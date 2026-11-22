/**
 * Миграция таблицы лаборатории: бюллетень и дата из общей ячейки — в свои колонки (`LaboratorBook`).
 *
 *   sync.mjs --laborator --migrate [--apply] <Laborator.xlsx>
 *
 * Порядок:
 *   1. Шапка и колонки; таблица уже разделена — изменений нет.
 *   2. План: какие ячейки делятся, какие остаются как были (опечатка, объединение) — с причиной в журнале.
 *   3. С записью: таблица открыта в редакторе или её пишет другой прогон — миграция не выполняется (ошибка
 *      с причиной: это разовое действие, само оно не повторится). Рядом уже есть «<имя> Orig.xlsx» — тоже.
 *   4. Проверка новой книги до подмены (прежние значения на своих местах со сдвигом, разделённые — в новых колонках),
 *      бэкап (`backup/Laborator`), затем оригинал переименовывается в «<имя> Orig.xlsx», а новая книга ложится
 *      на место таблицы (`SafeSave.bytesKeeping`).
 */
import fs from 'node:fs'
import path from 'node:path'
import { message, MessageError } from '@/shared/messages'
import { ENGINE_EXIT } from '@/shared/protocol'
import { cellText, cellValue } from '../Cells'
import { Backups, EditorLock, FileBusyError, FileLock } from '../FileGuard'
import type { RunReport } from '../RunReport'
import { SafeSave } from '../SyncWriter'
import { dateLabel, finalAddress, finalColumn, LaboratorBook, type LabLayout, type SplitPlan } from './LaboratorBook'

/** Параметры миграции. */
export interface LabMigrationOptions {
  /** Таблица лаборатории. */
  file: string
  apply: boolean
  guardOpenFiles: boolean
  backupDays: number
}

/** Имя, под которым остаётся оригинал: «Laborator.xlsx» → «Laborator Orig.xlsx». */
export function originalName(file: string): string {
  const ext = path.extname(file)
  return path.join(path.dirname(file), `${path.basename(file, ext)} Orig${ext}`)
}

/** Миграция таблицы лаборатории. */
export class LaboratorMigration {
  private readonly options: LabMigrationOptions
  private readonly report: RunReport
  private readonly stamp: string

  constructor(options: LabMigrationOptions, report: RunReport, stamp: string) {
    this.options = options
    this.report = report
    this.stamp = stamp
  }

  /** @returns Код выхода. */
  async run(): Promise<number> {
    const { file, apply } = this.options
    const { report } = this
    const summary = report.summary
    const name = path.basename(file)
    const before = fs.statSync(file)
    const book = await LaboratorBook.open(fs.readFileSync(file))
    const layout = book.layout()
    if (!layout.splits.length) {
      report.say('tech.labAlready', { file: name })
      return ENGINE_EXIT.ok
    }
    const plan = book.plan(layout)
    report.say('tech.labRead', { sheet: layout.sheet.name, row: layout.header, rows: plan.rows })
    for (const split of layout.splits) {
      const cells = plan.cells.filter((c) => c.split === split).length
      summary.split.push({ column: split.title, cells })
      report.say('tech.labColumn', { column: split.title, cell: finalAddress(layout, layout.header, split.column), cells }, 'plan')
    }
    for (const kept of plan.kept) {
      const why = kept.why === 'merged' ? message('laborator.merged') : message('laborator.unparsed', { text: kept.text.replace(/\s+/g, ' ') })
      const cell = finalAddress(layout, kept.row, kept.split.column)
      summary.skipped.push({ project: null, element: cell, reason: why })
      report.caution('tech.labSkipped', { cell, why })
    }
    if (!apply) {
      report.line()
      report.say('tech.dryRun')
      return ENGINE_EXIT.ok
    }

    const keep = originalName(file)
    if (fs.existsSync(keep)) throw new MessageError(message('laborator.origExists', { file: path.basename(keep) }))
    // открытая таблица: сохранение из редактора вернуло бы прежний вид поверх разделённого
    if (this.options.guardOpenFiles && EditorLock.find(file)) throw new MessageError(message('laborator.open', { file: name }))
    const lock = new FileLock(file)
    try {
      lock.acquire()
    } catch (error) {
      if (!(error instanceof FileBusyError)) throw error
      throw new MessageError(message('laborator.busy', { reason: error.msg }))
    }
    try {
      for (const n of lock.notes) report.note(n)
      const now = fs.statSync(file)
      if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) throw new MessageError(message('laborator.changed', { file: name }))
      const original = book.snapshot()
      book.split(layout, plan)
      const bytes = await book.toBytes()
      this.verify(await LaboratorBook.open(bytes), original, layout, plan, name)
      new Backups(this.options.backupDays).save([{ file, kind: 'laborator' }], this.stamp)
      summary.backup = this.stamp
      report.say('tech.backup', { stamp: this.stamp, files: `--laborator "${file}"` }, 'ok')
      await SafeSave.bytesKeeping(file, bytes, keep)
      summary.original = path.basename(keep)
      summary.wrote = true
      summary.verified = true
      report.say('tech.labSaved', { file: name, original: summary.original }, 'ok')
      return ENGINE_EXIT.ok
    } finally {
      lock.release()
    }
  }

  /**
   * Сверка новой книги до подмены файла: прежние значения всех листов на своих местах (на листе таблицы — со сдвигом
   * колонок), кроме шапки и разделённых ячеек делимых колонок; разделённые — в своих новых колонках.
   * @throws {MessageError} `laborator.integrity` — таблица не меняется.
   */
  private verify(saved: LaboratorBook, original: Map<string, string>, layout: LabLayout, plan: SplitPlan, file: string): void {
    const sheet = layout.sheet.name
    const changed = new Set(plan.cells.map((c) => `${c.row}:${c.split.column}`))
    const splitColumns = new Set(layout.splits.map((s) => s.column))
    const now = saved.snapshot()
    const fail = (row: number, column: number) => new MessageError(message('laborator.integrity', { cell: `${sheet}!${finalAddress(layout, row, column)}`, file }))
    for (const [key, value] of original) {
      const [where, place] = key.split(/!(?=\d+:\d+$)/) as [string, string]
      const [row, column] = place.split(':').map(Number) as [number, number]
      if (where !== sheet) {
        if (now.get(key) !== value) throw new MessageError(message('laborator.integrity', { cell: key, file }))
        continue
      }
      if (changed.has(`${row}:${column}`) || (row === layout.header && splitColumns.has(column))) continue
      if (now.get(`${sheet}!${row}:${finalColumn(layout, column)}`) !== value) throw fail(row, column)
    }
    const target = saved.workbook.getWorksheet(sheet)!
    for (const { row, split, parsed } of plan.cells) {
      const at = finalColumn(layout, split.column)
      const [value, bulletin, date] = split.withValue ? [at, at + 1, at + 2] : [null, at, at + 1]
      const ok =
        (value === null || cellValue(target.getCell(row, value)) === parsed.value) &&
        cellText(target.getCell(row, bulletin)) === (parsed.bulletin ?? '') &&
        (() => {
          const v = cellValue(target.getCell(row, date))
          return parsed.date ? v instanceof Date && dateLabel(v) === dateLabel(parsed.date) : v === null
        })()
      if (!ok) throw fail(row, split.column)
    }
  }
}
