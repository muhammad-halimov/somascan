/**
 * Таблица на сетевом диске Windows (SMB).
 *
 * - Блокировка — папка `<таблица>.lock`: `mkdir` на сервере атомарен, второй `mkdir` получает `exists`.
 *   Внутри — `owner.json` с устройством и временем; брошенная блокировка снимается по сроку.
 * - Замена — в нативной части одним вызовом: временный файл → сверка SHA-256 → прежний файл
 *   переименовывается в резервную копию → временный становится таблицей.
 * - Если прошлая запись оборвалась между переименованиями, временный файл становится таблицей.
 * - Таблица и её папка должны уже быть на сервере: приложение их не создаёт (`tableNotFound`).
 */
import { bytesToUtf8, utf8ToBytes } from '@/lib/encoding/base64'
import { isRecord } from '@/lib/validation/guards'
import { UploadError } from '../UploadError'
import { LOCK_STALE_MS, type TableBackend, type TableProbeResult } from '../worker/TableBackend'
import type { BackupPolicy } from '../xlsx/BackupPolicy'
import type { SmbConnection, SmbShareClient } from './SmbShare'
import { TABLE_EXTENSION, type TablePaths } from './smbSettings'

/** Файл внутри папки-блокировки с владельцем и временем. */
const LOCK_OWNER_FILE = 'owner.json'

/** Содержимое файла владельца блокировки. */
interface LockOwner {
  /** Идентификатор устройства. */
  owner: string
  /** Когда поставлена (мс с начала эпохи, по часам устройства). */
  createdAt: number
}

/** Таблица на общей папке. */
export class SmbTableBackend implements TableBackend {
  readonly stem: string
  readonly extension = TABLE_EXTENSION
  /** Файловые операции. */
  private readonly share: SmbShareClient
  /** Подключение. */
  private readonly connection: SmbConnection
  /** Пути таблицы, блокировки, копий. */
  private readonly paths: TablePaths
  /** Текущее время. */
  private readonly now: () => number

  /**
   * @param share Файловые операции на общей папке.
   * @param connection Параметры подключения.
   * @param paths Пути таблицы.
   * @param now Текущее время.
   */
  constructor(share: SmbShareClient, connection: SmbConnection, paths: TablePaths, now: () => number = Date.now) {
    this.share = share
    this.connection = connection
    this.paths = paths
    this.stem = paths.stem
    this.now = now
  }

  async acquireLock(owner: string) {
    const { share, connection, paths } = this
    for (let attempt = 0; ; attempt++) {
      try {
        await share.mkdir(connection, paths.lock)
        break
      } catch (error) {
        // Нет папки таблицы — нет и таблицы; папки не создаём.
        if (error instanceof UploadError && error.code === 'notFound') throw new UploadError('tableNotFound', { path: paths.target })
        if (!(error instanceof UploadError) || error.code !== 'exists') throw error
        const holder = await this.readLockOwner()
        const createdAt = holder?.createdAt ?? (await this.lockFolderTime())
        if (createdAt === null) continue // блокировку только что сняли — пробуем снова
        if (attempt === 0 && this.now() - createdAt > LOCK_STALE_MS) {
          await share.remove(connection, paths.lock).catch(() => undefined)
          continue
        }
        throw new UploadError('busy', { owner: holder?.owner })
      }
    }
    const record: LockOwner = { owner, createdAt: this.now() }
    await share.write(connection, `${paths.lock}/${LOCK_OWNER_FILE}`, utf8ToBytes(JSON.stringify(record)))
  }

  async releaseLock() {
    try {
      await this.share.remove(this.connection, this.paths.lock)
    } catch (error) {
      console.warn('[uploads] lock release', error)
    }
  }

  async read(): Promise<Uint8Array | null> {
    await this.recover()
    try {
      return await this.share.read(this.connection, this.paths.target)
    } catch (error) {
      if (error instanceof UploadError && error.code === 'notFound') return null
      throw error
    }
  }

  async replace(bytes: Uint8Array, backupName: string) {
    await this.share.commit(this.connection, this.paths.target, bytes, `${this.paths.backupDir}/${backupName}`)
  }

  readBack(): Promise<Uint8Array> {
    return this.share.read(this.connection, this.paths.target)
  }

  async pruneBackups(policy: BackupPolicy, now: number) {
    try {
      const entries = await this.share.list(this.connection, this.paths.backupDir)
      for (const entry of policy.expired(entries, now)) {
        await this.share.remove(this.connection, `${this.paths.backupDir}/${entry.name}`)
      }
    } catch (error) {
      if (error instanceof UploadError && error.code === 'notFound') return
      console.warn('[uploads] backups cleanup', error)
    }
  }

  async probe(): Promise<TableProbeResult> {
    const { share, connection, paths } = this
    const table = await share.probe(connection, paths.target)
    if (table.exists && table.isDirectory) throw new UploadError('invalidPath', { path: paths.target })
    if (!table.exists && paths.dir) {
      const dir = await share.probe(connection, paths.dir)
      if (dir.exists && !dir.isDirectory) throw new UploadError('invalidPath', { path: paths.target })
    }
    return { exists: table.exists, size: table.size, modifiedAt: table.modifiedAt }
  }

  /** Владелец блокировки из её файла или `null`, если файла нет или он повреждён. */
  private async readLockOwner(): Promise<LockOwner | null> {
    try {
      const data: unknown = JSON.parse(bytesToUtf8(await this.share.read(this.connection, `${this.paths.lock}/${LOCK_OWNER_FILE}`)))
      if (isRecord(data) && typeof data.owner === 'string' && typeof data.createdAt === 'number') return { owner: data.owner, createdAt: data.createdAt }
      return null
    } catch {
      return null
    }
  }

  /** Время папки-блокировки (когда файла владельца нет) или `null`, если папки уже нет. */
  private async lockFolderTime(): Promise<number | null> {
    const stat = await this.share.probe(this.connection, this.paths.lock)
    return stat.exists ? stat.modifiedAt : null
  }

  /** Если прошлая запись оборвалась между переименованиями, временный файл становится таблицей. */
  private async recover() {
    const { share, connection, paths } = this
    const table = await share.probe(connection, paths.target)
    if (table.exists) return
    const tmp = await share.probe(connection, paths.tmp)
    if (tmp.exists && !tmp.isDirectory) await share.rename(connection, paths.tmp, paths.target)
  }
}
