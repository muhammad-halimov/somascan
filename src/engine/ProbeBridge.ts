/**
 * Мост с телефонами: бирки, которые телефоны записали в копию Probe на Google Drive, переносятся в Probe
 * на этом компьютере или сетевом диске той же строкой, что записал бы телефон (`lab/LabelWorkbook`).
 *
 *   sync.mjs --bridge [--apply] <копия Probe.xlsx> <Probe.xlsx>
 *
 * Копию скачивает до прогона и заменяет после него главный процесс (`host/PhoneBridge`), под той же блокировкой
 * Drive, что ставят телефоны. Порядок:
 *   1. Новые бирки — записи служебного листа копии, номеров которых нет в служебном листе Probe.
 *   2. Каждая дописывается в Probe: в лист, куда её записал телефон (лист года, которого в Probe ещё нет, создаётся),
 *      каждая плавка — один раз. Не записать (плавка уже есть в Probe, листа нет, запись прежней версии без бирки) —
 *      бирка пропускается с причиной. После замены копии на Probe её там не останется: причина — в журнале.
 *   3. Probe открыт в редакторе или его пишет другой прогон — запись откладывается (код 3), бирки ждут в копии.
 *   4. Бэкап Probe, проверка новой книги до подмены (все прежние значения на месте, перенесённые бирки находятся
 *      в своих строках) и подмена файла (`SafeSave`).
 */
import fs from 'node:fs'
import path from 'node:path'
import { message, MessageError } from '@/shared/messages'
import { ENGINE_EXIT, type SummaryBridged } from '@/shared/protocol'
import { Backups, EditorLock, FileBusyError, FileLock } from './FileGuard'
import { HEAT_KEY, type LabelValue } from './lab/labelValues'
import { LabError, LabelWorkbook, type JournalRecord } from './lab/LabelWorkbook'
import type { RunReport } from './RunReport'
import { SafeSave } from './SyncWriter'

/** Параметры переноса. */
export interface BridgeOptions {
  /** Скачанная копия Probe с Google Drive. */
  copy: string
  /** Probe на этом компьютере или сетевом диске. */
  probe: string
  apply: boolean
  guardOpenFiles: boolean
  backupDays: number
}

/** Текст значения поля бирки (пусто — `''`). */
const text = (value: LabelValue | undefined) => (value === null || value === undefined ? '' : String(value).trim())

/**
 * Лист для записи: лист года записи передаётся пустым — такой лист создаётся, если его в Probe ещё нет
 * (телефон мог создать его в копии первым); другой лист должен быть в Probe.
 */
function sheetFor(record: JournalRecord): string {
  return /^\d{4}$/.test(record.sheet) && record.sheet === String(new Date(record.writtenAt).getFullYear()) ? '' : record.sheet
}

/** Перенос бирок с телефонов в Probe. */
export class ProbeBridge {
  private readonly options: BridgeOptions
  private readonly report: RunReport
  private readonly stamp: string

  constructor(options: BridgeOptions, report: RunReport, stamp: string) {
    this.options = options
    this.report = report
    this.stamp = stamp
  }

  /** @returns Код выхода. */
  async run(): Promise<number> {
    const { copy, probe, apply } = this.options
    const { report } = this
    const summary = report.summary
    const before = fs.statSync(probe)
    const phone = await LabelWorkbook.open(fs.readFileSync(copy), path.basename(copy))
    const book = await LabelWorkbook.open(fs.readFileSync(probe), path.basename(probe))
    const original = book.snapshot()
    // по номеру записи: повторы в копии не считаются, записанные в Probe — уже перенесены
    const records = new Map<string, JournalRecord>()
    for (const r of phone.journalRecords()) if (!records.has(r.record)) records.set(r.record, r)
    const known = new Set(book.journalRecords().map((r) => r.record))
    const fresh = [...records.values()].filter((r) => !known.has(r.record))
    report.say('tech.bridgeRead', { records: records.size, fresh: fresh.length })

    for (const record of fresh) {
      const heat = text(record.entry?.label[HEAT_KEY])
      const element = heat || record.record
      if (!record.entry) {
        summary.skipped.push({ project: null, element, reason: message('bridge.noEntry', { record: record.record }) })
        continue
      }
      try {
        const row = book.append(record.entry, record.writtenAt || Date.now(), { sheet: sheetFor(record), uniqueHeat: true })
        const bridged: SummaryBridged = { record: record.record, heat, producer: text(record.entry.label.producer), sheet: row.sheet, row: row.row, item: row.item }
        summary.bridged.push(bridged)
        report.say('tech.bridgeLine', { heat: element, sheet: row.sheet, row: row.row }, 'plan')
      } catch (error) {
        if (!(error instanceof LabError)) throw error
        summary.skipped.push({ project: null, element, reason: error.msg })
      }
    }
    for (const s of summary.skipped) report.caution('tech.bridgeSkipped', { element: s.element, why: s.reason })
    if (!summary.bridged.length) {
      report.say('tech.bridgeNothing')
      return ENGINE_EXIT.ok
    }
    if (!apply) {
      report.line()
      report.say('tech.dryRun')
      return ENGINE_EXIT.ok
    }

    // Probe открыт в редакторе: сохранение из редактора затёрло бы перенесённое — бирки ждут в копии.
    const editor = this.options.guardOpenFiles ? EditorLock.find(probe) : null
    if (editor) {
      const reason = message('warn.deferredOpen', { file: path.basename(probe) })
      summary.deferred.push({ file: path.basename(probe), reason, lockFile: editor.lockFile })
      report.warning(reason, false)
      return ENGINE_EXIT.deferred
    }
    const lock = new FileLock(probe)
    try {
      lock.acquire()
    } catch (error) {
      if (!(error instanceof FileBusyError)) throw error
      summary.deferred.push({ file: path.basename(probe), reason: error.msg, lockFile: null })
      report.warning(message('warn.deferredBusy', { reason: error.msg }), false)
      return ENGINE_EXIT.deferred
    }
    try {
      for (const n of lock.notes) report.note(n)
      // Probe сохранили, пока он читался, — перенос повторится по новой версии.
      const now = fs.statSync(probe)
      if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) {
        const reason = message('bridge.probeChanged', { file: path.basename(probe) })
        summary.deferred.push({ file: path.basename(probe), reason, lockFile: null })
        report.warning(reason, false)
        return ENGINE_EXIT.deferred
      }
      const bytes = await book.toBytes()
      this.verify(await LabelWorkbook.open(bytes, path.basename(probe)), original, summary.bridged)
      new Backups(this.options.backupDays).save([probe], this.stamp)
      summary.backup = this.stamp
      report.say('tech.backup', { stamp: this.stamp, files: `"${probe}"` }, 'ok')
      await SafeSave.bytes(probe, bytes)
      summary.wrote = true
      summary.verified = true
      report.say('tech.bridgeSaved', { n: summary.bridged.length }, 'ok')
      return ENGINE_EXIT.ok
    } finally {
      lock.release()
    }
  }

  /**
   * Сверка новой книги до подмены файла: прежние значения всех листов на месте, перенесённые бирки — в своих строках.
   * @throws {MessageError} `bridge.integrity` — Probe не пишется.
   */
  private verify(saved: LabelWorkbook, original: Map<string, string>, bridged: readonly SummaryBridged[]): void {
    const now = saved.snapshot()
    for (const [key, value] of original) {
      if (now.get(key) !== value) throw new MessageError(message('bridge.integrity', { cell: key }))
    }
    for (const b of bridged) {
      const at = saved.locate(b.record)
      if (!at || at.sheet !== b.sheet || at.row !== b.row) throw new MessageError(message('bridge.integrity', { cell: `${b.sheet}!${b.row}` }))
    }
  }
}
