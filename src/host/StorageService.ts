/**
 * Вкладка «Хранилище»: проверка таблиц и сетевой диск (`SmbShare`). Таблицы в Google Drive проверяет
 * `DriveService` (есть ли в папке), листы — эта же проверка по скачанной копии.
 *
 * Проверка: есть ли файл и совпадает ли его строение с тем, что программа из него читает и куда пишет:
 *   цех          — листы: «Decont Lunar» в Consum, лист года в Probe, листы проектов в Sarjele;
 *   лаборатория  — шапка с «Rc decofr.», «Nr.bul.», «Data» (таблица разделена миграцией) и «Rc 28 zile»;
 *   качество     — пока только что файл есть и читается (полей у программы ещё нет).
 * Листы читаются из `xl/workbook.xml`, шапка — из первых строк листов (`./workbookHead`), без разбора всей книги:
 * быстро даже для большого файла на сетевом диске. Файлы читаются асинхронно (`./files`): медленный сетевой диск
 * не останавливает программу; не ответил за `CHECK_TIMEOUT_MS` — проверка сообщает об этом.
 *
 * Таблицы на сетевом диске читаются средствами системы, как обычные файлы; перед работой программа подключает
 * общую папку сама, если таблицы на ней недоступны (`SyncService.readyToRead`).
 */
import fs from 'node:fs'
import JSZip from 'jszip'
import { columnLetters } from '@/engine/Cells'
import { findHeader, HEADER_ROWS } from '@/engine/laborator/LabHeader'
import { message, MessageError, type Message } from '@/shared/messages'
import type { CheckResult, ShareResult } from '@/shared/protocol'
import { activeFiles, deskFile, DESKS, isOneOf, type FileKind } from '@/shared/settings'
import type { DriveService } from './drive/DriveService'
import { openInEditor, withTimeout } from './files'
import type { Journal } from './Journal'
import type { SettingsStore } from './SettingsStore'
import { SmbShare } from './SmbShare'
import { workbookHead } from './workbookHead'

/** Сколько ждать проверки таблицы, мс: дольше — сетевой диск не отвечает. */
const CHECK_TIMEOUT_MS = 20_000

/** Проверка файлов и сетевой диск. */
export class StorageService {
  private readonly settings: SettingsStore
  private readonly drive: DriveService
  /** Сетевой диск. */
  readonly smb: SmbShare

  constructor(settings: SettingsStore, drive: DriveService, journal: Journal) {
    this.settings = settings
    this.drive = drive
    this.smb = new SmbShare(settings, journal)
  }

  /** Видимые листы книги. */
  static async visibleSheets(file: string | JSZip): Promise<string[]> {
    const zip = typeof file === 'string' ? await JSZip.loadAsync(await fs.promises.readFile(file)) : file
    const xml = await zip.file('xl/workbook.xml')!.async('string')
    const hidden = (tag: string) => /state="(hidden|veryHidden)"/.test(tag)
    return [...xml.matchAll(/<sheet\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((t) => !hidden(t))
      .map((t) => (t.match(/name="([^"]*)"/)?.[1] ?? '').replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"'))
  }

  /** Проверяет файл вида `kind` (по умолчанию — путь из настроек; у Google Drive — имя в папке). */
  check(kind: FileKind, fileArg?: string): Promise<CheckResult> {
    const settings = this.settings.getSnapshot()
    // таблица лаборатории или контроля качества — только на этом компьютере или сетевом диске
    if (isOneOf(DESKS)(kind)) return this.checkFile(kind, fileArg ?? deskFile(settings, kind))
    const file = fileArg ?? (kind === 'consum' ? '' : activeFiles(settings)[kind])
    if (this.drive.active()) return this.drive.check(kind, file, (k, local) => this.checkFile(k, local))
    return this.checkFile(kind, file)
  }

  /** Проверяет файл на этом компьютере (или на подключённом диске): есть ли, совпадает ли строение. */
  checkFile(kind: FileKind, file: string): Promise<CheckResult> {
    if (!file) return Promise.resolve({ ok: false, msg: message('check.noPath') })
    const timeout = (): CheckResult => ({ ok: false, msg: message('check.timeout', { seconds: CHECK_TIMEOUT_MS / 1000 }) })
    return withTimeout(this.readCheck(kind, file), CHECK_TIMEOUT_MS, timeout)
  }

  /** Проверка файла: чтение листов (и шапки) и сверка с тем, что программа из него читает. */
  private async readCheck(kind: FileKind, file: string): Promise<CheckResult> {
    const settings = this.settings.getSnapshot()
    const st = await fs.promises.stat(file).catch(() => null)
    if (!st) return { ok: false, msg: message('check.notFound') }
    try {
      const bytes = await fs.promises.readFile(file)
      const sheets = await StorageService.visibleSheets(await JSZip.loadAsync(bytes))
      if (kind === 'consum' && !sheets.includes('Decont Lunar')) return { ok: false, msg: message('check.noConsumSheet'), sheets }
      if (kind === 'probe') {
        const year = new Date().getFullYear()
        if (!sheets.includes(String(year)) && !settings.sheet) return { ok: false, msg: message('check.noYearSheet', { year }), sheets }
      }
      if (kind === 'sarjele') {
        const missing = settings.projects.filter((p) => p.enabled !== false && p.sheet && !p.create && !sheets.includes(p.sheet)).map((p) => p.sheet)
        if (missing.length) return { ok: false, msg: message('check.noProjectSheets', { sheets: missing.join(', ') }), sheets }
      }
      const open = await openInEditor(file)
      if (kind === 'laborator') {
        const header = await StorageService.labHeader(bytes)
        if ('error' in header) return { ok: false, msg: header.error, sheets }
        return { ok: true, msg: message(open ? 'check.labOkOpen' : 'check.labOk', { columns: header.columns, date: st.mtimeMs }), sheets }
      }
      return { ok: true, msg: message(open ? 'check.okOpen' : 'check.ok', { n: sheets.length, date: st.mtimeMs }), sheets }
    } catch (e) {
      return { ok: false, msg: message('check.unreadable', { error: (e as Error).message }) }
    }
  }

  /**
   * Шапка таблицы лаборатории (как её ищет движок): разделена ли таблица и где «Rc decofr.», «Nr.bul.», «Data».
   * @returns Строка шапки и колонки («H–J») или почему таблица не подходит.
   */
  static async labHeader(bytes: Uint8Array): Promise<{ row: number; columns: string } | { error: Message }> {
    try {
      const header = findHeader(await workbookHead(bytes, HEADER_ROWS))
      if (header.splits.length) return { error: message('check.labNotSplit') }
      return { row: header.header, columns: `${columnLetters(header.decofr)}–${columnLetters(header.decofr + 2)}` }
    } catch (e) {
      if (e instanceof MessageError) return { error: e.msg }
      throw e
    }
  }

  /** Таблицы цеха на сетевом диске: выбран ли он местом хранения. */
  active(): boolean {
    return this.settings.getSnapshot().target === 'smb'
  }

  /** Подключает общую папку (итог — в журнал). */
  mount(): Promise<ShareResult> {
    return this.smb.mount()
  }
}
