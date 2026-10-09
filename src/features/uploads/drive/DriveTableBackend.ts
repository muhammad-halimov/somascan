/**
 * Таблица в Google Drive.
 *
 * - Блокировка. В Drive нет атомарного «создать, если нет» (имена могут повторяться), поэтому:
 *   устройство создаёт файл `<таблица>.lock` со своим id, перечитывает все такие файлы, и
 *   побеждает самый ранний (при равенстве — с меньшим id); проигравший удаляет свой и ждёт (`busy`).
 *   Брошенные блокировки старше `LOCK_STALE_MS` удаляются, свои (этого же устройства) — сразу:
 *   своя блокировка при новой попытке — след оборванной записи (см. `SmbTableBackend`).
 * - Замена. Загрузка нового содержимого — новая ревизия файла, атомарно. Перед ней прежний файл
 *   копируется на сервере в папку `backups`, а версия файла сверяется с прочитанной: если таблицу
 *   успели изменить (Excel онлайн, другое устройство) — `busy`, запись повторится с новыми данными.
 *   После загрузки MD5, посчитанный Drive, сверяется с MD5 отправленных байтов.
 * - Таблица должна уже лежать в папке: приложение её не создаёт (`tableNotFound`).
 */
import { md5Hex } from '@/lib/encoding/md5'
import { UploadError } from '../UploadError'
import { TABLE_EXTENSION } from '../smb/smbSettings'
import { LOCK_STALE_MS, type TableBackend, type TableProbeResult } from '../worker/TableBackend'
import { BACKUP_FOLDER, type BackupPolicy } from '../xlsx/BackupPolicy'
import { FOLDER_MIME, XLSX_MIME, type DriveClient, type DriveFile } from './DriveClient'

/** Метка владельца в свойствах файла-блокировки. */
const LOCK_OWNER_PROPERTY = 'somascanLockOwner'

/** Время создания файла (мс) — для сравнения блокировок. */
const createdMs = (file: DriveFile) => (file.createdTime ? Date.parse(file.createdTime) : 0)

/** Таблица в папке Drive. */
export class DriveTableBackend implements TableBackend {
  readonly stem: string
  readonly extension = TABLE_EXTENSION
  /** Клиент Drive. */
  private readonly drive: DriveClient
  /** Папка таблицы. */
  private readonly folderId: string
  /** Имя таблицы. */
  private readonly name: string
  /** Текущее время. */
  private readonly now: () => number
  /** Наша блокировка (файл), пока она стоит. */
  private lock: DriveFile | null = null
  /** Таблица на момент чтения: id и версия для проверки перед заменой. */
  private table: DriveFile | null = null

  /**
   * @param drive Клиент Drive.
   * @param folderId Id папки (или `root`).
   * @param name Имя таблицы с расширением.
   * @param now Текущее время.
   */
  constructor(drive: DriveClient, folderId: string, name: string, now: () => number = Date.now) {
    this.drive = drive
    this.folderId = folderId
    this.name = name
    this.stem = name.slice(0, -TABLE_EXTENSION.length)
    this.now = now
  }

  async acquireLock(owner: string) {
    await this.requireFolder()
    const lockName = `${this.name}.lock`
    // Брошенные блокировки (устройство выключили посреди записи) и свои, оставшиеся от оборванной записи, снимаем.
    const leftovers = (await this.drive.find(this.folderId, lockName))
      .filter((file) => file.appProperties?.[LOCK_OWNER_PROPERTY] === owner || this.now() - createdMs(file) > LOCK_STALE_MS)
    for (const stale of leftovers) await this.drive.remove(stale.id)
    const others = await this.drive.find(this.folderId, lockName)
    if (others.length > 0) throw new UploadError('busy', { owner: others[0]!.appProperties?.[LOCK_OWNER_PROPERTY] })
    const mine = await this.drive.create(this.folderId, lockName, new TextEncoder().encode(owner), 'text/plain', { [LOCK_OWNER_PROPERTY]: owner })
    // Два устройства могли создать блокировку одновременно: побеждает самая ранняя.
    const contenders = (await this.drive.find(this.folderId, lockName))
      .sort((a, b) => createdMs(a) - createdMs(b) || a.id.localeCompare(b.id))
    if (contenders[0] && contenders[0].id !== mine.id) {
      await this.drive.remove(mine.id)
      throw new UploadError('busy', { owner: contenders[0].appProperties?.[LOCK_OWNER_PROPERTY] })
    }
    this.lock = mine
  }

  async releaseLock() {
    if (!this.lock) return
    try {
      await this.drive.remove(this.lock.id)
    } catch (error) {
      console.warn('[uploads] drive lock release', error)
    } finally {
      this.lock = null
    }
  }

  async read(): Promise<Uint8Array | null> {
    const [table] = await this.drive.find(this.folderId, this.name)
    this.table = table ?? null
    if (!table) return null
    if (table.mimeType !== XLSX_MIME && !table.name.toLowerCase().endsWith(TABLE_EXTENSION)) {
      throw new UploadError('corruptWorkbook', { detail: `${table.name}: ${table.mimeType}` })
    }
    return this.drive.download(table.id)
  }

  async replace(bytes: Uint8Array, backupName: string) {
    if (!this.table) throw new UploadError('tableNotFound', { path: this.name })
    const expected = md5Hex(bytes)
    await this.drive.copy(this.table.id, (await this.backupFolderId(true))!, backupName)
    // Таблицу изменили после чтения — не затираем чужие строки, повторим с новыми данными.
    const current = await this.drive.get(this.table.id)
    if (!current || current.version !== this.table.version) throw new UploadError('busy', { detail: 'table changed during write' })
    const saved = await this.drive.update(this.table.id, bytes, XLSX_MIME)
    this.table = saved
    if (saved.md5Checksum && saved.md5Checksum !== expected) {
      throw new UploadError('verifyFailed', { detail: `md5 ${saved.md5Checksum} ≠ ${expected}` })
    }
  }

  readBack(): Promise<Uint8Array> {
    if (!this.table) throw new UploadError('notFound', { detail: 'table missing after save' })
    return this.drive.download(this.table.id)
  }

  async pruneBackups(policy: BackupPolicy, now: number) {
    try {
      const folderId = await this.backupFolderId(false)
      if (!folderId) return
      const entries = (await this.drive.children(folderId))
        .filter((file) => file.mimeType !== FOLDER_MIME)
        .map((file) => ({ file, entry: { name: file.name, isDirectory: false, size: Number(file.size ?? 0), modifiedAt: createdMs(file) } }))
      const expired = new Set(policy.expired(entries.map((item) => item.entry), now).map((entry) => entry.name))
      for (const { file } of entries) if (expired.has(file.name)) await this.drive.remove(file.id)
    } catch (error) {
      console.warn('[uploads] drive backups cleanup', error)
    }
  }

  async probe(): Promise<TableProbeResult> {
    await this.requireFolder()
    const [table] = await this.drive.find(this.folderId, this.name)
    if (!table) return { exists: false, size: 0, modifiedAt: 0 }
    return { exists: true, size: Number(table.size ?? 0), modifiedAt: table.modifiedTime ? Date.parse(table.modifiedTime) : 0 }
  }

  /**
   * Проверяет, что папка существует и это папка.
   * @throws {UploadError} `folderNotFound`.
   */
  private async requireFolder() {
    const folder = await this.drive.get(this.folderId)
    if (!folder || folder.mimeType !== FOLDER_MIME) throw new UploadError('folderNotFound', { path: this.folderId })
  }

  /** Id папки `backups` рядом с таблицей; при `create` создаёт её, иначе `null`, если её нет. */
  private async backupFolderId(create: boolean): Promise<string | null> {
    const [folder] = await this.drive.find(this.folderId, BACKUP_FOLDER, FOLDER_MIME)
    if (folder) return folder.id
    return create ? (await this.drive.createFolder(this.folderId, BACKUP_FOLDER)).id : null
  }
}
