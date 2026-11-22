/**
 * Чтение таблицы лаборатории при слежении: последняя запись «Rc decofr.», «Nr.bul.», «Data» и подпись лаборанта —
 * в итог прогона (пока только в журнал: позже они пойдут в документы).
 *
 *   sync.mjs --laborator --read <Laborator.xlsx>        (подпись лаборанта — путь в SIGNATURE)
 *
 * Таблица не меняется, но перед чтением — копия (`backup/Laborator`) в любом случае.
 * Таблица должна быть разделена (миграция): бюллетень и дата — в своих колонках справа от «Rc decofr.».
 * Последняя запись — нижняя строка под шапкой, где заполнено хоть одно из трёх полей: лаборант дописывает
 * таблицу вниз, а строки ниже бывают заготовлены заранее (дата и добавка без результатов).
 */
import fs from 'node:fs'
import path from 'node:path'
import { message, MessageError } from '@/shared/messages'
import { ENGINE_EXIT, type SummaryLabEntry } from '@/shared/protocol'
import { cellValue, columnLetters, type Scalar } from '../Cells'
import { Backups } from '../FileGuard'
import type { RunReport } from '../RunReport'
import { dateLabel, LaboratorBook, type LabLayout } from './LaboratorBook'

/** Параметры чтения. */
export interface LabReadOptions {
  /** Таблица лаборатории. */
  file: string
  /** Подпись лаборанта (PNG в папке данных программы) или пусто. */
  signature: string
  backupDays: number
}

/** Текст поля: дата — «09.01.2026», пусто — `null`. */
function fieldText(value: Scalar): string | null {
  if (value === null) return null
  const text = value instanceof Date ? dateLabel(value) : String(value).trim()
  return text || null
}

/** Последняя запись «Rc decofr.» / «Nr.bul.» / «Data» под шапкой или `null`, если ни одной нет. */
export function latestEntry(layout: LabLayout): Omit<SummaryLabEntry, 'signature'> | null {
  const { sheet, header, decofr } = layout
  for (let row = sheet.rowCount; row > header; row--) {
    const [value, bulletin, date] = [0, 1, 2].map((k) => fieldText(cellValue(sheet.getCell(row, decofr + k))))
    if (value === null && bulletin === null && date === null) continue
    return { row, cell: `${columnLetters(decofr)}${row}`, value: value ?? null, bulletin: bulletin ?? null, date: date ?? null }
  }
  return null
}

/** Чтение таблицы лаборатории. */
export class LaboratorReader {
  private readonly options: LabReadOptions
  private readonly report: RunReport
  private readonly stamp: string

  constructor(options: LabReadOptions, report: RunReport, stamp: string) {
    this.options = options
    this.report = report
    this.stamp = stamp
  }

  /** @returns Код выхода. */
  async run(): Promise<number> {
    const { file, signature, backupDays } = this.options
    const { report } = this
    const name = path.basename(file)
    // копия — до разбора: и неузнанная таблица остаётся в бэкапах
    new Backups(backupDays).save([{ file, kind: 'laborator' }], this.stamp)
    report.summary.backup = this.stamp
    report.say('tech.backup', { stamp: this.stamp, files: `--laborator "${file}"` }, 'ok')

    const book = await LaboratorBook.open(fs.readFileSync(file))
    const layout = book.layout()
    if (layout.splits.length) throw new MessageError(message('laborator.notSplit', { file: name }))
    report.say('tech.labHeader', { sheet: layout.sheet.name, row: layout.header, columns: `${columnLetters(layout.decofr)}–${columnLetters(layout.decofr + 2)}` })

    const entry = latestEntry(layout)
    if (!entry) {
      report.say('tech.labEmpty', { file: name })
      return ENGINE_EXIT.ok
    }
    const empty = message('tech.labNone')
    report.say('tech.labLatest', { row: entry.row, cell: entry.cell, value: entry.value ?? empty, bulletin: entry.bulletin ?? empty, date: entry.date ?? empty }, 'ok')
    const signed = !!signature && fs.existsSync(signature)
    if (signature && !signed) report.warning(message('laborator.signatureMissing'))
    report.say(signed ? 'tech.labSignature' : 'tech.labNoSignature', signed ? { file: path.basename(signature) } : undefined)
    report.summary.lab = { ...entry, signature: signed ? path.basename(signature) : null }
    return ENGINE_EXIT.ok
  }
}
