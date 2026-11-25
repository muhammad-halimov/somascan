/**
 * Запись в рапорт Betsy (кнопка «Запись» у лаборатории): результат «Rc decofr.» элемента рапорта из таблицы
 * лаборатории — в строку 6 рапорта (прочность, дата) с подписью лаборанта.
 *
 *   sync.mjs --laborator --betsy <Laborator.xlsx> <рапорт.docx>   (подпись — путь в SIGNATURE)
 *
 * Какой рапорт (выбранный вручную или последний в директории), решает главный процесс (`host/files`
 * `resolveBetsyReport`) — так же, как проверка на вкладке «Хранилище»; движок получает сам файл.
 *
 * Порядок:
 *   1. Рапорт открыт в Word — запись не выполняется.
 *   2. Копии таблицы лаборатории (`backup/Laborator`, таблица не меняется) и рапорта (`backup/Betsy` рядом с ним).
 *   3. Элемент рапорта («COD ELEMENT», «Serie», «PROIECT NR», «TURNAT LA») и его строка в таблице лаборатории
 *      (`laborator/LabMatch`: «Data» результата — за 0–3 рабочих дня до «TURNAT LA», выходные не в счёт): нет
 *      такой — ошибка с тем, что искали.
 *   4. Запись под блокировкой (`FileLock`): рапорт сохранили во время прогона — запись не выполняется; новый файл
 *      проверяется до подмены и после неё (прочность, дата, подпись на месте).
 */
import fs from 'node:fs'
import path from 'node:path'
import { message, MessageError, type Message } from '@/shared/messages'
import { ENGINE_EXIT } from '@/shared/protocol'
import { workdaysBefore } from '@/shared/workdays'
import { columnLetters } from '../Cells'
import { Backups, EditorLock, FileBusyError, FileLock } from '../FileGuard'
import { dateLabel, LaboratorBook } from '../laborator/LaboratorBook'
import { DATE_WINDOW_DAYS, findLabMatches, missingColumns, valueLabel } from '../laborator/LabMatch'
import type { RunReport } from '../RunReport'
import { SafeSave } from '../SyncWriter'
import { BetsyReport, pngSize, type ReportSignature } from './BetsyReport'

/** Параметры записи. */
export interface BetsyWriteOptions {
  /** Таблица лаборатории. */
  lab: string
  /** Рапорт. */
  file: string
  /** Подпись лаборанта (PNG в папке данных программы) или пусто. */
  signature: string
  backupDays: number
  guardOpenFiles: boolean
}

/** Запись в рапорт Betsy. */
export class BetsyWriter {
  private readonly options: BetsyWriteOptions
  private readonly report: RunReport
  private readonly stamp: string

  constructor(options: BetsyWriteOptions, report: RunReport, stamp: string) {
    this.options = options
    this.report = report
    this.stamp = stamp
  }

  /** @returns Код выхода. */
  async run(): Promise<number> {
    const { lab, file, signature, backupDays, guardOpenFiles } = this.options
    const { report } = this
    const summary = report.summary
    const name = path.basename(file)
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) throw new MessageError(message('betsy.notFound', { path: file }))
    report.say('tech.betsyReport', { file })
    // открытый рапорт: Word не увидит записанное, а его сохранение затрёт его
    const editor = guardOpenFiles ? EditorLock.find(file) : null
    if (editor) throw new MessageError(message('betsy.open', { file: name }))
    const before = fs.statSync(file)

    // копии — до разбора: и неузнанные файлы остаются в бэкапах
    new Backups(backupDays).save([{ file: lab, kind: 'laborator' }, { file, kind: 'betsy' }], this.stamp)
    summary.backup = this.stamp
    report.say('tech.backup', { stamp: this.stamp, files: `--laborator "${lab}" --betsy "${file}"` }, 'ok')

    const doc = await BetsyReport.open(fs.readFileSync(file))
    const { element } = doc
    if (!element.code) throw new MessageError(message('betsy.noElement', { file: name }))
    if (!element.cast) throw new MessageError(message('betsy.noCast', { file: name, text: element.castText || '—' }))
    const none = message('tech.labNone')
    report.say('tech.betsyElement', { code: element.code, serie: element.serie || none, project: element.project || none, cast: element.castText })

    const book = await LaboratorBook.open(fs.readFileSync(lab))
    const layout = book.layout()
    if (layout.splits.length) throw new MessageError(message('laborator.notSplit', { file: path.basename(lab) }))
    const missing = missingColumns(layout)
    if (missing.length) throw new MessageError(message('betsy.labColumns', { columns: missing.join(', ') }))
    report.say('tech.labHeader', { sheet: layout.sheet.name, row: layout.header, columns: `${columnLetters(layout.decofr)}–${columnLetters(layout.decofr + 2)}` })
    const matches = findLabMatches(layout, { code: element.code, serie: element.serie, project: element.project, date: element.cast })
    const best = matches[0]
    const from = dateLabel(workdaysBefore(element.cast, DATE_WINDOW_DAYS))
    if (!best) throw new MessageError(message('betsy.noLabEntry', { code: element.code, from, to: dateLabel(element.cast) }))
    const value = valueLabel(best.value)
    const date = dateLabel(best.date, '/')
    report.say('tech.betsyMatch', { row: best.row, cell: best.cell, value, bulletin: best.bulletin, date: dateLabel(best.date) }, 'ok')
    if (matches.length > 1) report.say('tech.betsyOthers', { n: matches.length - 1, rows: matches.slice(1).map((m) => m.row).join(', ') })
    if (element.serie && !best.serie) report.warning(message('betsy.serieNotFound', { serie: element.serie, row: best.row }))

    const sign = this.signature(signature)
    await doc.fill({ value, date, signature: sign })
    const bytes = await doc.toBytes()
    await this.save(file, bytes, before)

    // проверка после записи: рапорт читается, в строке 6 — записанное
    const saved = await BetsyReport.open(fs.readFileSync(file))
    const problems: Message[] = []
    if (saved.lab.value !== value) problems.push(message('betsy.verifyValue', { want: value, got: saved.lab.value ?? '—' }))
    if (saved.lab.date !== date) problems.push(message('betsy.verifyDate', { want: date, got: saved.lab.date || '—' }))
    if (sign && !saved.lab.signed) problems.push(message('betsy.verifySignature'))
    summary.problems = problems
    summary.verified = problems.length === 0
    summary.wrote = true
    summary.betsy = {
      report: name,
      element: element.code,
      serie: element.serie,
      cast: element.castText,
      row: best.row,
      value,
      bulletin: best.bulletin,
      date: dateLabel(best.date),
      signature: sign ? path.basename(signature) : null,
      others: matches.length - 1,
    }
    report.say('tech.betsySaved', { file: name, value, date }, 'ok')
    return ENGINE_EXIT.ok
  }

  /** Подпись лаборанта: PNG из настроек; не выбрана или не читается — рапорт пишется без неё (предупреждение). */
  private signature(file: string): ReportSignature | null {
    const { report } = this
    if (!file) {
      report.warning(message('betsy.noSignature'))
      report.say('tech.labNoSignature')
      return null
    }
    const png = fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null
    const size = png && pngSize(png)
    if (!png || !size) {
      report.warning(message('laborator.signatureMissing'))
      return null
    }
    report.say('tech.labSignature', { file: path.basename(file) })
    return { png, ...size }
  }

  /**
   * Подменяет рапорт новым под блокировкой: рапорт сохранили во время прогона — запись не выполняется; новый файл
   * сначала проверяется (открывается как рапорт).
   */
  private async save(file: string, bytes: Uint8Array, before: fs.Stats): Promise<void> {
    const name = path.basename(file)
    const lock = new FileLock(file)
    try {
      lock.acquire()
    } catch (error) {
      if (!(error instanceof FileBusyError)) throw error
      throw new MessageError(message('betsy.busy', { reason: error.msg }))
    }
    try {
      for (const n of lock.notes) this.report.note(n)
      const now = fs.statSync(file)
      if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) throw new MessageError(message('betsy.changed', { file: name }))
      await SafeSave.bytes(file, bytes, async (tmp) => BetsyReport.open(fs.readFileSync(tmp)))
    } finally {
      lock.release()
    }
  }
}
