/**
 * Мост с телефонами. Телефоны без доступа к сети компании пишут бирки в копию Probe в Google Drive (мобильное
 * приложение с местом хранения Google Drive), а программа переносит их в Probe на этом компьютере или сетевом диске
 * и выкладывает Probe на место копии — телефоны видят свежий журнал (номера элементов, плавки).
 *
 * Работает, пока идёт слежение с записью в файлы, включено «Телефоны» и таблицы — не в Google Drive (там телефоны
 * и так пишут в тот же Probe). Папка и имя копии — те же, что у места хранения Google Drive. Проверка — из цикла
 * слежения (`ConsumWatcher`), не чаще раза в `POLL_MS`: Drive не умеет сообщать об изменении файла без публичного
 * адреса, поэтому сверяется MD5 копии (содержимое: смена доступа к файлу или его версии изменением не считается).
 *   - Копию изменили (MD5 ≠ сверенному): под блокировкой Drive — той же, что ставят телефоны, — копия скачивается,
 *     движок переносит новые бирки (`--bridge`, `engine/ProbeBridge`), Probe выкладывается на место копии.
 *   - Изменился только Probe (правка в Excel, закраска плавок): Probe выкладывается на место копии — в сверенной
 *     копии нет ничего, чего нет в Probe.
 *   - Копии нет — она создаётся из Probe.
 * Probe открыт в редакторе — перенос откладывается и копия не заменяется (иначе бирки с телефонов пропали бы);
 * повтор — когда файл закроют. Ошибка переноса не повторяется, пока не изменятся копия или Probe.
 * Сверенное состояние (MD5 копии и «время:размер» Probe) хранится в `bridge.json`: после перезапуска
 * лишнего прогона нет.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Backups, EditorLock } from '@/engine/FileGuard'
import { message, type Message } from '@/shared/messages'
import { ENGINE_EXIT, type BridgeState } from '@/shared/protocol'
import type { AppPaths } from './AppPaths'
import { DriveMirror } from './drive/DriveMirror'
import { driveMessage, type DriveService } from './drive/DriveService'
import type { Journal } from './Journal'
import type { SettingsStore } from './SettingsStore'
import type { SyncService } from './SyncService'

/** Как часто сверять копию, мс. */
export const POLL_MS = 10_000

/** Имя копии, если в настройках Google Drive оно пустое. */
const DEFAULT_NAME = 'Probe otel.xlsx'

/** Сверенное состояние: какая копия и какой Probe совпадают. */
interface Synced {
  /** Папка и имя копии: другие — сверка заново. */
  where: string
  /** MD5 копии на Drive. */
  copy: string
  /** «Время:размер» Probe. */
  probe: string
}

/** Что откладывает перенос: копия, при которой он отложен, и почему. */
interface Hold {
  copy: string
  probe: string
  /** Probe открыт в редакторе (иначе — ошибка переноса). */
  editor: boolean
}

/** «Время:размер» файла или `null`. */
function stampOf(file: string): string | null {
  try {
    const st = fs.statSync(file)
    return `${st.mtimeMs}:${st.size}`
  } catch {
    return null
  }
}

/** Мост с телефонами. */
export class PhoneBridge {
  private readonly settings: SettingsStore
  private readonly journal: Journal
  private readonly sync: SyncService
  private readonly mirror: DriveMirror
  private readonly stateFile: string
  private readonly now: () => number
  private synced: Synced | null
  private hold: Hold | null = null
  private lastPoll = 0
  /** Код последней ошибки (в журнал — один раз, пока не пройдёт). */
  private lastProblem: string | null = null

  constructor(paths: AppPaths, settings: SettingsStore, journal: Journal, sync: SyncService, drive: DriveService, now: () => number = Date.now) {
    this.settings = settings
    this.journal = journal
    this.sync = sync
    this.now = now
    // своя копия и свои блокировки: не мешают месту хранения Google Drive
    this.mirror = new DriveMirror(path.join(paths.data, 'drive-phones'), () => drive.client(), `somasync:${os.hostname()}`)
    this.stateFile = path.join(paths.data, 'bridge.json')
    this.synced = this.readSynced()
  }

  /** Работает ли мост: включён, таблицы не в Google Drive, слежение с записью. */
  active(): boolean {
    const s = this.settings.getSnapshot()
    return s.bridge && s.target !== 'googleDrive' && s.write && this.sync.getSnapshot().status === 'watching'
  }

  /** Одна проверка (из цикла слежения): не чаще раза в `POLL_MS`. */
  async tick(): Promise<void> {
    if (!this.active() || this.sync.getSnapshot().busy || this.now() - this.lastPoll < POLL_MS) return
    this.lastPoll = this.now()
    const s = this.settings.getSnapshot()
    const probe = this.settings.files().probe.trim()
    if (!probe || !fs.existsSync(probe)) return
    const folder = s.googleDrive.folder
    const name = path.basename(s.files.googleDrive.probe.trim()) || DEFAULT_NAME
    const where = `${folder}|${name}`
    const synced = this.synced?.where === where ? this.synced : null
    try {
      const file = await this.mirror.remoteFile(folder, name)
      const copy = file ? (file.md5Checksum ?? `${file.version ?? ''}:${file.size ?? ''}`) : null
      if (copy === null) await this.locked(folder, name, () => this.publish(folder, name, probe, where, true))
      else if (copy !== synced?.copy) {
        const hold = this.hold?.copy === copy ? this.hold : null
        if (hold && (hold.editor ? this.editorOpen(probe) : hold.probe === stampOf(probe))) return
        await this.transfer(folder, name, probe, where, copy)
      } else if (stampOf(probe) !== synced.probe) await this.locked(folder, name, () => this.publish(folder, name, probe, where))
      this.problem(null)
    } catch (error) {
      // телефон пишет копию прямо сейчас или копию изменили между проверкой и выкладкой — следующая проверка
      const msg = driveMessage(error)
      if (msg.code === 'drive.busy' || msg.code === 'drive.conflict') return
      this.problem(msg)
    }
  }

  /** Бирки с телефонов из копии в Probe, затем Probe — на место копии. */
  private async transfer(folder: string, name: string, probe: string, where: string, copy: string): Promise<void> {
    await this.sync.bridge((engine) => this.locked(folder, name, async () => {
      const missing = await this.mirror.pull(folder, [name])
      if (missing.length) return
      const before = stampOf(probe) ?? ''
      const { code, summary } = await engine(name, ['--bridge', '--apply', path.join(this.mirror.dir(folder), name), probe])
      if (code === ENGINE_EXIT.deferred) {
        const editor = summary?.deferred.some((d) => d.lockFile !== null) ?? false
        this.hold = { copy, probe: before, editor }
        this.patch({ waiting: editor })
        return
      }
      if (code !== ENGINE_EXIT.ok) {
        this.hold = { copy, probe: stampOf(probe) ?? '', editor: false }
        return
      }
      this.hold = null
      await this.publish(folder, name, probe, where)
    }))
  }

  /**
   * Выкладывает Probe на место копии и запоминает сверенное состояние.
   * @param create Копии нет — она создаётся.
   */
  private async publish(folder: string, name: string, probe: string, where: string, create = false): Promise<void> {
    const probeStamp = stampOf(probe) ?? ''
    const copy = await this.mirror.publish(folder, name, probe, Backups.stamp(), this.settings.getSnapshot().backupDays)
    this.synced = { where, copy, probe: probeStamp }
    this.writeSynced()
    this.patch({ syncedAt: this.now(), waiting: false })
    if (create) this.journal.event('ok', message('bridge.created', { file: name }))
  }

  /** Выполняет `fn` под блокировкой копии (той же, что у телефонов). */
  private async locked<T>(folder: string, name: string, fn: () => Promise<T>): Promise<T> {
    await this.mirror.lock(folder, [name])
    try {
      return await fn()
    } finally {
      await this.mirror.release()
    }
  }

  /** Probe открыт в редакторе (и запись в открытые файлы запрещена). */
  private editorOpen(probe: string): boolean {
    return this.settings.getSnapshot().guardOpenFiles && EditorLock.find(probe) !== null
  }

  /** Что мешает мосту: в состояние окна, в журнал — один раз (без перебоев связи). */
  private problem(msg: Message | null): void {
    if (msg && msg.code !== this.lastProblem && msg.code !== 'drive.network') this.journal.event('warn', message('bridge.failed', { error: msg }))
    this.lastProblem = msg?.code ?? null
    if (msg || this.sync.getSnapshot().bridge.problem) this.patch({ problem: msg })
  }

  private patch(patch: Partial<BridgeState>): void {
    this.sync.patch({ bridge: { ...this.sync.getSnapshot().bridge, ...patch } })
  }

  private readSynced(): Synced | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as Partial<Synced>
      return typeof raw.where === 'string' && typeof raw.copy === 'string' && typeof raw.probe === 'string' ? (raw as Synced) : null
    } catch {
      return null
    }
  }

  private writeSynced(): void {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.synced))
    } catch {
      // не записалось — после перезапуска копия сверится ещё раз
    }
  }
}
