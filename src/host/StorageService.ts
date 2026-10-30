/**
 * Вкладка «Хранилище»: проверка файлов и подключение сетевого диска Windows (SMB). Таблицы в Google Drive
 * проверяет `DriveService` (есть ли в папке), листы — эта же проверка по скачанной копии.
 *
 * Проверка: есть ли файл, какие в нём листы, нужные ли. Листы читаются из `xl/workbook.xml` без разбора всей
 * книги — быстро даже для большого файла на сетевом диске.
 *
 * Подключение:
 *   macOS   — `osascript … mount volume smb://…`: диск появляется в /Volumes, пути к таблицам берутся оттуда;
 *   Windows — `net use \\сервер\папка`: пути к таблицам — прямо `\\сервер\папка\…` (букву диска можно не назначать).
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import JSZip from 'jszip'
import { EditorLock } from '@/engine/FileGuard'
import { message } from '@/shared/messages'
import type { ActionResult, CheckResult } from '@/shared/protocol'
import { activeFiles, type FileKind, type SmbSettings } from '@/shared/settings'
import type { DriveService } from './drive/DriveService'
import type { SettingsStore } from './SettingsStore'

/** Сколько ждать подключения диска, мс. */
const MOUNT_TIMEOUT_MS = 60_000

/** Последняя содержательная строка ошибки. */
const lastLine = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() ?? text

/** Проверка файлов и сетевой диск. */
export class StorageService {
  private readonly settings: SettingsStore
  private readonly drive: DriveService

  constructor(settings: SettingsStore, drive: DriveService) {
    this.settings = settings
    this.drive = drive
  }

  /** Сетевой путь общей папки в Windows: `\\сервер\папка`. */
  static uncPath(smb: Pick<SmbSettings, 'host' | 'share'>): string {
    return `\\\\${smb.host}\\${smb.share}`
  }

  /** Видимые листы книги. */
  static async visibleSheets(file: string): Promise<string[]> {
    const zip = await JSZip.loadAsync(fs.readFileSync(file))
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
    const file = fileArg ?? (kind === 'consum' ? '' : activeFiles(settings)[kind])
    if (this.drive.active()) return this.drive.check(kind, file, (k, local) => this.checkFile(k, local))
    return this.checkFile(kind, file)
  }

  /** Проверяет файл на этом компьютере (или на подключённом диске): есть ли, какие листы, нужные ли. */
  async checkFile(kind: FileKind, file: string): Promise<CheckResult> {
    const settings = this.settings.getSnapshot()
    if (!file) return { ok: false, msg: message('check.noPath') }
    if (!fs.existsSync(file)) return { ok: false, msg: message('check.notFound') }
    try {
      const st = fs.statSync(file)
      const sheets = await StorageService.visibleSheets(file)
      if (kind === 'consum' && !sheets.includes('Decont Lunar')) return { ok: false, msg: message('check.noConsumSheet'), sheets }
      if (kind === 'probe') {
        const year = new Date().getFullYear()
        if (!sheets.includes(String(year)) && !settings.sheet) return { ok: false, msg: message('check.noYearSheet', { year }), sheets }
      }
      if (kind === 'sarjele') {
        const missing = settings.projects.filter((p) => p.enabled !== false && p.sheet && !p.create && !sheets.includes(p.sheet)).map((p) => p.sheet)
        if (missing.length) return { ok: false, msg: message('check.noProjectSheets', { sheets: missing.join(', ') }), sheets }
      }
      return { ok: true, msg: message(EditorLock.find(file) ? 'check.okOpen' : 'check.ok', { n: sheets.length, date: st.mtimeMs }), sheets }
    } catch (e) {
      return { ok: false, msg: message('check.unreadable', { error: (e as Error).message }) }
    }
  }

  /** Подключает общую папку средствами системы. @returns Куда подключено (`mount`) или ошибка. */
  mount(): Promise<ActionResult & { mount?: string }> {
    const smb = this.settings.getSnapshot().smb
    const password = this.settings.smbPassword()
    const { host, share, domain, username } = smb
    if (!host || !share) return Promise.resolve({ ok: false, error: message('smb.noHost') })
    const failed = (error: string) => ({ ok: false, error: message('error.other', { error }) })
    if (process.platform === 'win32') {
      const unc = StorageService.uncPath(smb)
      const args = ['use', unc, ...(username ? [...(password ? [password] : []), `/user:${domain ? `${domain}\\` : ''}${username}`] : []), '/persistent:no']
      return new Promise((resolve) =>
        execFile('net', args, { timeout: MOUNT_TIMEOUT_MS, windowsHide: true }, (err, _out, stderr) => {
          // 1219 — к серверу уже подключены под этим или другим именем: папка доступна
          if (err && !/\b1219\b/.test(String(stderr))) resolve(failed(lastLine(String(stderr) || err.message)))
          else resolve({ ok: true, mount: unc })
        }))
    }
    if (process.platform !== 'darwin') return Promise.resolve({ ok: false, error: message('smb.unsupported') })
    const user = username ? `${domain ? encodeURIComponent(domain) + ';' : ''}${encodeURIComponent(username)}${password ? ':' + encodeURIComponent(password) : ''}@` : ''
    const url = `smb://${user}${host}/${encodeURIComponent(share)}`
    return new Promise((resolve) =>
      execFile('osascript', ['-e', 'on run argv', '-e', 'mount volume (item 1 of argv)', '-e', 'end run', url], { timeout: MOUNT_TIMEOUT_MS }, (err, out) => {
        if (err) resolve(failed(lastLine(err.message)))
        else resolve({ ok: true, mount: String(out).trim() })
      }))
  }
}
