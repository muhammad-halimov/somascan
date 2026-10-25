/**
 * Запись прогона в файлы и проверка после записи.
 *
 * Порядок:
 *   1. Открыт ли файл в редакторе? Sarjele или Probe открыты — запись откладывается целиком (они должны меняться
 *      вместе); открыт только Consum — откладываются его ID.
 *   2. Блокировки всех записываемых файлов (`<файл>.lock`). Занято другим прогоном — запись откладывается.
 *   3. Бэкап под одной меткой (откат — `--restore <метка>`).
 *   4. Sarjele → Probe → Consum. Каждый файл — через временный файл с проверкой и подменой.
 *   5. Проверка: файлы перечитываются и сравниваются с расчётом (расход по плавкам, ID у блоков и в реестре,
 *      закраска плавок, ID в Consum). Расхождение не откатывает запись (бэкап есть), а попадает в журнал.
 * Каждый файл пишется через временный файл (`SafeSave`).
 * Отложенная запись — не ошибка: движок завершается с кодом 3, и программа повторит прогон, когда файл закроют.
 */
import fs from 'node:fs'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { formatRu, message, type Message, type MessageCode } from '@/shared/messages'
import type { SummaryDeferred } from '@/shared/protocol'
import { CONSUM_SHEET, ConsumBook } from './books/ConsumBook'
import { patchIds } from './books/ConsumIdPatcher'
import { ProbeBook } from './books/ProbeBook'
import { SarjeleBook } from './books/SarjeleBook'
import { SarjeleWriter } from './books/SarjeleWriter'
import { Backups, EditorLock, FileBusyError, FileLock } from './FileGuard'
import type { ChangeSet, PlanResult } from './planning/Planner'
import type { RunReport } from './RunReport'
import type { Workspace } from './Workspace'

/** Итог записи. */
export interface WriteOutcome {
  deferred: SummaryDeferred[]
  /** Расхождения проверки после записи (`null` — не проверялось). */
  problems: Message[] | null
  /** Хоть один файл записан. */
  wrote: boolean
  /** «время:размер» Consum после записи ID или `null`. */
  consumAfter: string | null
}

/** Что проверить после записи. */
interface VerifyInput {
  sarjele?: { used: ReadonlyMap<string, number>; ids: readonly string[] }
  probe?: { closed: ReadonlySet<string>; reopened: ReadonlySet<string> }
  consum?: { ids: ReadonlyMap<number, string> }
}

/** Сколько расхождений проверки выводить в журнал. */
const MAX_PROBLEMS = 10
/** Допуск сравнения кг (расход в целых кг). */
const KG_TOLERANCE = 0.5
/** Заметки, которые в итоге окна уже есть в другом виде (ID, листы, открытые плавки). */
const TEXT_ONLY_NOTES = new Set<MessageCode>(['note.renamed', 'note.idMoved', 'note.linked', 'note.blockCreated', 'note.sheetCreated', 'note.heatReopened'])

/**
 * Замена файла таблицы: временный файл → проверка, что он открывается как книга → подмена переименованием
 * (одна атомарная операция: при сбое посреди записи оригинал остаётся целым).
 */
export class SafeSave {
  /** Записывает книгу ExcelJS на место `file`. Блокировку берёт вызывающий. */
  static async workbook(file: string, workbook: ExcelJS.Workbook): Promise<void> {
    const tmp = `${file}.tmp`
    await workbook.xlsx.writeFile(tmp)
    await SafeSave.assertReadable(tmp)
    fs.renameSync(tmp, file)
  }

  /** Записывает готовые байты (Consum правится прямо в XML). Блокировку берёт вызывающий. */
  static async bytes(file: string, bytes: Uint8Array): Promise<void> {
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, bytes)
    await SafeSave.assertReadable(tmp)
    fs.renameSync(tmp, file)
  }

  /**
   * Записывает книгу под блокировкой.
   * @returns Заметки о снятых брошенных блокировках.
   * @throws {FileBusyError} Файл записывает другой прогон.
   */
  static async lockedWorkbook(file: string, workbook: ExcelJS.Workbook): Promise<Message[]> {
    const lock = new FileLock(file)
    await lock.with(() => SafeSave.workbook(file, workbook))
    return lock.notes
  }

  /** Проверяет, что файл открывается как книга. */
  private static async assertReadable(file: string): Promise<void> {
    await new ExcelJS.Workbook().xlsx.readFile(file)
  }
}

/** Пишет изменения прогона. */
export class SyncWriter {
  private readonly ws: Workspace
  private readonly report: RunReport
  private readonly stamp: string
  private readonly warnings: Message[] = []
  private readonly notes: Message[] = []

  constructor(ws: Workspace, report: RunReport, stamp: string) {
    this.ws = ws
    this.report = report
    this.stamp = stamp
  }

  /** Пишет изменения. */
  async write(result: PlanResult, changes: ChangeSet): Promise<WriteOutcome> {
    const { options, consum } = this.ws
    const { notes, warnings, report } = this
    const deferred: SummaryDeferred[] = []
    const out: WriteOutcome = { deferred, problems: null, wrote: false, consumAfter: null }

    // 1. открытые файлы
    if (options.guardOpenFiles) {
      for (const [need, file] of [[changes.sarjele, options.sarjele], [changes.probe, options.probe]] as const) {
        const busy = need ? SyncWriter.editorBusy(file) : null
        if (busy) deferred.push(busy)
      }
      if (deferred.length) {
        for (const d of deferred) report.warning(d.reason, false)
        return out
      }
    }
    let writeConsum = changes.consum
    const consumIds = changes.consumIds
    if (writeConsum) {
      const busy = SyncWriter.editorBusy(options.consum)
      if (busy) {
        notes.push(message('note.consumIdsDeferred', { n: consumIds.size }))
        deferred.push(busy)
        writeConsum = false
      }
    }

    // 2. блокировки
    const locks = new Map<string, FileLock>()
    const lockFile = (file: string): SummaryDeferred | null => {
      const lock = new FileLock(file)
      try {
        lock.acquire()
        locks.set(file, lock)
        notes.push(...lock.notes)
        return null
      } catch (e) {
        if (e instanceof FileBusyError) return { file: path.basename(file), reason: e.msg, lockFile: null }
        throw e
      }
    }
    const consumName = path.basename(options.consum)
    try {
      for (const [need, file] of [[changes.sarjele, options.sarjele], [changes.probe, options.probe]] as const) {
        const busy = need ? lockFile(file) : null
        if (busy) deferred.push(busy)
      }
      if (deferred.some((d) => d.file !== consumName)) {
        for (const d of deferred) if (d.file !== consumName) report.warning(message('warn.deferredBusy', { reason: d.reason }), false)
        notes.length = 0
        return out
      }
      if (writeConsum) {
        const busy = lockFile(options.consum)
        if (busy) {
          notes.push(message('note.consumNotUpdated', { reason: busy.reason }))
          deferred.push(busy)
          writeConsum = false
        }
      }

      // 3. бэкап
      const backed = [options.sarjele, options.probe, ...(changes.consum ? [options.consum] : [])]
      new Backups(options.backupDays).save(backed, this.stamp)
      report.summary.backup = this.stamp
      report.line(`Бэкап: ${this.stamp}   (откат: node sync.mjs --restore ${this.stamp} ${backed.map((f) => `"${f}"`).join(' ')})`)

      // 4. запись
      const verify: VerifyInput = {}
      if (changes.sarjele) {
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.readFile(options.sarjele)
        const r = new SarjeleWriter(wb, this.ws.probe).apply({
          plan: changes.plan,
          acts: changes.acts,
          consumIds,
          catalog: this.ws.catalog,
          ownership: this.ws.ownership,
          source: this.ws.source,
          periodKey: consum.period.key,
        })
        warnings.push(...r.warnings)
        notes.push(...r.notes)
        await SafeSave.workbook(options.sarjele, wb)
        out.wrote = true
        verify.sarjele = { used: result.allocator.used, ids: r.placedIds }
        const links = changes.acts.filter((a) => a.res.kind === 'migrate' || a.res.kind === 'new').length
        report.line(`\n✔ Sarjele обновлён (блоков: ${changes.plan.length}, привязок: ${links})`)
      }
      if (changes.probe) {
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.readFile(options.probe)
        notes.push(...this.ws.probe.paint(wb, result.toClose, result.toReopen))
        await SafeSave.workbook(options.probe, wb)
        out.wrote = true
        verify.probe = { closed: result.toClose, reopened: result.toReopen }
        report.line(`✔ Probe: закрашено ${result.toClose.size}, открыто обратно ${result.toReopen.size}`)
      }
      if (writeConsum) await this.writeConsumIds(consumIds, verify, out)
      for (const w of warnings) report.warning(w)
      for (const n of notes) report.note(n, !TEXT_ONLY_NOTES.has(n.code))

      // 5. проверка
      out.problems = await this.verify(verify)
      if (!out.problems.length) report.line('✔ Проверка после записи: файлы совпадают с расчётом')
      else {
        for (const p of out.problems.slice(0, MAX_PROBLEMS)) report.warn(`! Проверка после записи: ${formatRu(p)}`)
        if (out.problems.length > MAX_PROBLEMS) report.warn(`! Проверка после записи: и ещё ${out.problems.length - MAX_PROBLEMS}`)
      }
      return out
    } finally {
      for (const lock of locks.values()) lock.release()
    }
  }

  /** Файл открыт в редакторе — запись в него откладывается; иначе `null`. */
  private static editorBusy(file: string): SummaryDeferred | null {
    const lock = EditorLock.find(file)
    return lock ? { file: path.basename(file), reason: message('warn.deferredOpen', { file: path.basename(file) }), lockFile: lock.lockFile } : null
  }

  /** ID в колонку Consum (правкой XML, без пересохранения книги). */
  private async writeConsumIds(consumIds: Map<number, string>, verify: VerifyInput, out: WriteOutcome): Promise<void> {
    const { options, consum } = this.ws
    const st = fs.statSync(options.consum)
    if (st.mtimeMs !== consum.snapshot.mtimeMs || st.size !== consum.snapshot.size) {
      this.notes.push(message('note.consumChanged'))
      return
    }
    try {
      const col = consum.idColumn
      const r = await patchIds(options.consum, { sheetName: CONSUM_SHEET, col: col.col, header: col.hasHeader ? null : { row: 9, text: 'ID sync' }, ids: consumIds, look: col.look })
      if (!r.buffer) return
      await SafeSave.bytes(options.consum, r.buffer)
      out.wrote = true
      const after = fs.statSync(options.consum)
      out.consumAfter = `${after.mtimeMs}:${after.size}`
      this.report.line(`✔ Consum: записано ID — ${r.written}`)
      if (r.skipped.length) this.warnings.push(message('warn.consumIdsSkipped', { rows: r.skipped.join(', ') }))
      const skipped = new Set(r.skipped)
      verify.consum = { ids: new Map([...consumIds].filter(([row]) => !skipped.has(row))) }
    } catch (e) {
      this.notes.push(message('note.consumNotUpdated', { reason: (e as NodeJS.ErrnoException).code || (e as Error).message }))
    }
  }

  /** Перечитывает записанные файлы. @returns Расхождения (пусто — всё совпало). */
  private async verify(input: VerifyInput): Promise<Message[]> {
    const { options } = this.ws
    const problems: Message[] = []
    if (input.sarjele) {
      const { used, ids } = input.sarjele
      const now = await SarjeleBook.read(options.sarjele)
      for (const heat of new Set([...used.keys(), ...now.used.keys()])) {
        const want = used.get(heat) ?? 0
        const got = now.used.get(heat) ?? 0
        if (Math.abs(want - got) > KG_TOLERANCE) problems.push(message('verify.kg', { heat, got, want }))
      }
      const blockIds = new Set(now.blocks.map((b) => b.id).filter(Boolean))
      for (const id of ids) {
        if (!blockIds.has(id)) problems.push(message('verify.idMissing', { id }))
        else if (!now.registry.has(id)) problems.push(message('verify.idUnregistered', { id }))
      }
    }
    if (input.probe) {
      const { closed, reopened } = input.probe
      const now = await ProbeBook.read(options.probe, { sheets: options.probeSheets, explicit: options.probeSheetsExplicit, year: options.year })
      for (const heat of closed) if (!now.heats.get(heat)?.closed) problems.push(message('verify.notPainted', { heat }))
      for (const heat of reopened) if (now.heats.get(heat)?.closed) problems.push(message('verify.notUnpainted', { heat }))
    }
    if (input.consum && input.consum.ids.size) {
      const now = await ConsumBook.read(options.consum, () => null)
      const byRow = new Map(now.items.map((it) => [it.row, it.id]))
      for (const [row, id] of input.consum.ids) if (byRow.get(row) !== id) problems.push(message('verify.consumId', { row, id }))
    }
    return problems
  }
}
