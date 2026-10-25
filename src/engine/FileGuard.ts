/**
 * Защита файлов таблиц: блокировка записи, замки редакторов, бэкапы. Только `fs` — модуль использует и главный
 * процесс (открыт ли файл, список бэкапов).
 *
 *   FileLock    папка `<файл>.lock`: два прогона (две программы с общим сетевым диском) не пишут один файл разом
 *   EditorLock  файл открыт в редакторе таблиц — писать нельзя, запись откладывается
 *   Backups     копии файлов в папке `backups` рядом с ними под одной меткой прогона, откат к метке
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { message, MessageError, type Message } from '@/shared/messages'

// ── Блокировка записи ───────────────────────────────────────────────────────

/**
 * Через сколько блокировка считается брошенной.
 * РИСК: срок считается по часам этого компьютера и времени папки на сервере; если часы расходятся больше чем
 * на этот срок, чужую свежую блокировку можно принять за брошенную (или наоборот).
 */
export const LOCK_STALE_MS = 10 * 60_000

/** Кто держит блокировку (`owner.json`). */
interface LockOwner {
  pid: number
  host: string
  at: number
}

/** Файл занят другим прогоном. */
export class FileBusyError extends MessageError {
  /** Файл, который не удалось заблокировать. */
  readonly file: string
  constructor(file: string, msg: Message) {
    super(msg)
    this.name = 'FileBusyError'
    this.file = file
  }
}

/** Жив ли процесс этого компьютера. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Блокировка одного файла: папка `<файл>.lock` (создаётся одной атомарной операцией `mkdir`) с `owner.json`.
 *
 * Если программу закрыли посреди записи, папка остаётся. Такая блокировка снимается сама, если её взял процесс
 * этого компьютера, которого больше нет, или ей больше `LOCK_STALE_MS`. У папок прежних версий без `owner.json`
 * срок считается по времени изменения папки.
 */
export class FileLock {
  /** Блокируемый файл. */
  readonly file: string
  /** Папка блокировки. */
  readonly dir: string
  /** Снятые брошенные блокировки (для журнала). */
  readonly notes: Message[] = []
  private held = false
  /** Текущее время (подменяется в проверках). */
  private readonly now: () => number

  constructor(file: string, now: () => number = Date.now) {
    this.file = file
    this.now = now
    this.dir = `${file}.lock`
  }

  /**
   * Берёт блокировку; брошенную — снимает и берёт заново.
   * @throws {FileBusyError} Файл записывает другой прогон.
   */
  acquire(): void {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.mkdirSync(this.dir)
        const owner: LockOwner = { pid: process.pid, host: os.hostname(), at: this.now() }
        fs.writeFileSync(path.join(this.dir, 'owner.json'), JSON.stringify(owner))
        this.held = true
        return
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        const stale = this.staleNote()
        if (!stale || attempt > 0) throw new FileBusyError(this.file, this.busyMessage())
        fs.rmSync(this.dir, { recursive: true, force: true })
        this.notes.push(stale)
      }
    }
  }

  /** Снимает блокировку (если брали). */
  release(): void {
    if (!this.held) return
    fs.rmSync(this.dir, { recursive: true, force: true })
    this.held = false
  }

  /** Выполняет `fn` под блокировкой. */
  async with<T>(fn: () => Promise<T>): Promise<T> {
    this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  /** Владелец из `owner.json` или `null`. */
  private readOwner(): LockOwner | null {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir, 'owner.json'), 'utf8')) as Partial<LockOwner>
      return typeof raw.pid === 'number' && typeof raw.host === 'string' && typeof raw.at === 'number' ? (raw as LockOwner) : null
    } catch {
      return null
    }
  }

  /** Почему блокировка брошена (заметка для журнала), или `null`, если она живая. */
  private staleNote(): Message | null {
    const lock = path.basename(this.dir)
    const owner = this.readOwner()
    if (owner && owner.host === os.hostname() && !processAlive(owner.pid)) return message('lock.staleDead', { lock })
    let at = owner?.at
    if (at === undefined) {
      try {
        at = fs.statSync(this.dir).mtimeMs
      } catch {
        return message('lock.staleGone', { lock })
      }
    }
    return this.now() - at > LOCK_STALE_MS ? message('lock.staleOld', { lock, minutes: Math.round(LOCK_STALE_MS / 60_000) }) : null
  }

  /** Кто держит блокировку. */
  private busyMessage(): Message {
    const file = path.basename(this.file)
    const owner = this.readOwner()
    if (!owner) return message('lock.busyUnknown', { file })
    return owner.host === os.hostname() ? message('lock.busyHere', { file, time: owner.at }) : message('lock.busyHost', { file, host: owner.host, time: owner.at })
  }
}

// ── Замки редакторов ────────────────────────────────────────────────────────

/**
 * Файл-замок редактора рядом с открытым файлом: Excel — `~$<имя>` (у длинных имён иногда без первых двух букв),
 * LibreOffice и ONLYOFFICE — `.~lock.<имя>#`.
 *
 * Пока файл открыт, писать в него нельзя: редактор не перечитает изменения и покажет старую версию, а сохранение
 * из редактора затрёт записанное программой. Поэтому запись откладывается.
 *
 * РИСК: если редактор упал, замок может остаться и после закрытия файла — запись будет откладываться,
 * пока замок не удалят (путь к нему пишется в журнал) или пока не выключат «Не писать в открытые файлы».
 */
export class EditorLock {
  /** Путь к файлу-замку. */
  readonly lockFile: string

  private constructor(lockFile: string) {
    this.lockFile = lockFile
  }

  /** Замок редактора рядом с `file` или `null` (файл не открыт). */
  static find(file: string): EditorLock | null {
    const dir = path.dirname(file)
    const name = path.basename(file)
    const found = [`.~lock.${name}#`, `~$${name}`, `~$${name.slice(2)}`].map((x) => path.join(dir, x)).find((x) => fs.existsSync(x))
    return found ? new EditorLock(found) : null
  }

  /** Открытые в редакторах файлы из списка. */
  static openFiles(files: readonly string[]): Array<{ file: string; lock: EditorLock }> {
    return files.flatMap((file) => {
      const lock = EditorLock.find(file)
      return lock ? [{ file, lock }] : []
    })
  }
}

// ── Бэкапы ──────────────────────────────────────────────────────────────────

/** Миллисекунд в сутках. */
const DAY_MS = 864e5

/** Итог отката. */
export interface RestoreResult {
  /** Восстановленные файлы. */
  restored: string[]
  /** Метка, под которой сохранено состояние перед откатом. */
  savedAs: string
}

/**
 * Бэкапы: копия — `backups/<метка>_<имя файла>` рядом с файлом. Метка — время прогона (`2026-10-19T14-02-11-123Z`).
 * Все файлы прогона копируются с одной меткой и откатываются вместе. Копии старше срока удаляются при следующем бэкапе.
 */
export class Backups {
  /** Имя папки бэкапов рядом с файлами. */
  static readonly FOLDER = 'backups'

  /** Сколько дней хранить копии. */
  private readonly retentionDays: number

  constructor(retentionDays: number) {
    this.retentionDays = retentionDays
  }

  /** Метка прогона из времени. */
  static stamp(at = new Date()): string {
    return at.toISOString().replace(/[:.]/g, '-')
  }

  /** Метки бэкапов рядом с `file`, новые сверху. */
  static stamps(file: string, limit = 30): string[] {
    const dir = Backups.dir(file)
    if (!fs.existsSync(dir)) return []
    return [...new Set(fs.readdirSync(dir).map((x) => x.split('_')[0]!))].filter((s) => /^(\d{4}-|before-restore)/.test(s)).sort().reverse().slice(0, limit)
  }

  /**
   * Возвращает файлы к состоянию `stamp`. Текущее состояние сначала сохраняется под меткой `before-restore-…`.
   * Sarjele и Probe обязательны; Consum — если его копия есть.
   * @throws {MessageError} Нет копий Sarjele или Probe под этой меткой.
   */
  static restore(stamp: string, sarjele: string, probe: string, consums: readonly string[], at = new Date()): RestoreResult {
    const targets = [sarjele, probe, ...consums].filter(Boolean).filter((f) => fs.existsSync(Backups.copy(f, stamp)))
    if (!targets.length || !fs.existsSync(Backups.copy(sarjele, stamp)) || !fs.existsSync(Backups.copy(probe, stamp))) throw new MessageError(message('error.noCopies', { stamp }))
    const savedAs = `before-restore-${Backups.stamp(at)}`
    for (const file of targets) {
      fs.copyFileSync(file, path.join(Backups.dir(file), `${savedAs}_${path.basename(file)}`))
      fs.copyFileSync(Backups.copy(file, stamp), file)
    }
    return { restored: targets, savedAs }
  }

  /** Делает копии файлов под меткой и чистит просроченные. */
  save(files: readonly string[], stamp: string, now = Date.now()): void {
    for (const file of files) {
      const dir = Backups.dir(file)
      fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(file, Backups.copy(file, stamp))
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name)
        if (now - fs.statSync(p).mtimeMs > this.retentionDays * DAY_MS) fs.unlinkSync(p)
      }
    }
  }

  /** Папка бэкапов для файла. */
  private static dir(file: string): string {
    return path.join(path.dirname(file), Backups.FOLDER)
  }

  /** Путь копии файла под меткой. */
  private static copy(file: string, stamp: string): string {
    return path.join(Backups.dir(file), `${stamp}_${path.basename(file)}`)
  }
}
