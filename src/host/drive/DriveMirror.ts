/**
 * Таблицы в Google Drive для движка. Движок работает с файлами, поэтому таблицы из папки Drive скачиваются
 * в локальную копию (`<данные программы>/drive/<id папки>/`), движок читает и пишет её, а изменённое
 * выгружается обратно.
 *
 * - Скачивание — только изменившихся файлов: версия Drive и MD5 копии сверяются с запомненными (`.drive.json`).
 * - Блокировка на время прогона с записью — та же, что у мобильного приложения (`DriveTableBackend`):
 *   файл `<таблица>.lock` со своей меткой владельца; побеждает самый ранний, брошенные (старше 5 минут)
 *   и свои (от оборванного прогона) снимаются. Пока мобильное приложение пишет Probe, прогон ждёт, и наоборот.
 * - Выгрузка — только файлов, которые изменил движок (MD5 копии ≠ скачанному). Перед заменой прежняя версия
 *   копируется на сервере в папку `backups` рядом с таблицами (`<метка>_<имя>`, хранится столько же дней,
 *   сколько локальные копии), а версия файла сверяется со скачанной: если таблицу успели изменить (Excel
 *   онлайн, другое устройство), файл не выгружается — следующий прогон скачает новую версию и пересчитает.
 *   Новая ревизия ложится атомарно, после загрузки MD5 Drive сверяется с отправленным.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { message, MessageError } from '@/shared/messages'
import type { FileSet } from '@/shared/settings'
import { DriveError, FOLDER_MIME, XLSX_MIME, type DriveClient, type DriveFile } from './DriveClient'

/** Корень «Моего диска» в Drive API. */
export const DRIVE_ROOT = 'root'

/** Блокировка старше этого — брошенная (как у мобильного приложения). */
export const LOCK_STALE_MS = 5 * 60_000

/** Метка владельца в свойствах файла-блокировки (общая с мобильным приложением). */
const LOCK_OWNER_PROPERTY = 'somascanLockOwner'

/** Папка копий рядом с таблицами. */
const BACKUP_FOLDER = 'backups'

/** Файл с версиями скачанных таблиц в папке копии. */
const META_FILE = '.drive.json'

/** День, мс. */
const DAY_MS = 24 * 60 * 60 * 1000

/** Что запомнено о скачанной таблице. */
interface FileMeta {
  id: string
  version: string
  md5: string
}

/** Время создания файла (мс) — для сравнения блокировок и срока копий. */
const createdMs = (file: DriveFile) => (file.createdTime ? Date.parse(file.createdTime) : 0)

/** MD5 файла (hex). */
const md5Of = (bytes: Uint8Array) => crypto.createHash('md5').update(bytes).digest('hex')

/**
 * Id папки из поля «Папка»: ссылка вида `https://drive.google.com/drive/folders/<id>?usp=…`
 * (в том числе `/drive/u/0/folders/<id>` и `?id=<id>`) или сам id. Пустое поле — корень «Моего диска».
 * @throws {MessageError} `drive.badFolder`, если из ссылки не удаётся достать id.
 */
export function parseDriveFolder(input: string): string {
  const text = input.trim()
  if (!text) return DRIVE_ROOT
  const fromPath = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(text)
  if (fromPath) return fromPath[1]!
  const fromQuery = /[?&]id=([A-Za-z0-9_-]{10,})/.exec(text)
  if (fromQuery) return fromQuery[1]!
  if (/^[A-Za-z0-9_-]{10,}$/.test(text)) return text
  throw new MessageError(message('drive.badFolder', { folder: text }))
}

/** Локальная копия таблиц одной папки Drive. */
export class DriveMirror {
  /** Папка копий всех папок Drive. */
  private readonly root: string
  /** Клиент Drive с действующим токеном. */
  private readonly connect: () => Promise<DriveClient>
  /** Метка владельца блокировок (это устройство). */
  private readonly owner: string
  private readonly now: () => number
  /** Стоящие блокировки: имя таблицы → файл блокировки. */
  private readonly locks = new Map<string, DriveFile>()

  /**
   * @param root Папка копий (`<данные программы>/drive`).
   * @param connect Клиент Drive (вход и токен — у вызывающего).
   * @param owner Метка владельца блокировок.
   */
  constructor(root: string, connect: () => Promise<DriveClient>, owner: string, now: () => number = Date.now) {
    this.root = root
    this.connect = connect
    this.owner = owner
    this.now = now
  }

  /** Папка копии таблиц папки Drive `folder` (поле «Папка»). */
  dir(folder: string): string {
    let id = DRIVE_ROOT
    try {
      id = parseDriveFolder(folder)
    } catch {
      // неверная ссылка — прогон всё равно остановит `pull`
    }
    return path.join(this.root, id.replace(/[^A-Za-z0-9_-]/g, '_'))
  }

  /** Имена таблиц → пути их локальных копий (пустое имя остаётся пустым). */
  resolve(folder: string, names: FileSet): FileSet {
    const local = (name: string) => (name.trim() ? path.join(this.dir(folder), path.basename(name.trim())) : '')
    return { consums: names.consums.map(local), sarjele: local(names.sarjele), probe: local(names.probe) }
  }

  /**
   * Скачивает изменившиеся таблицы в копию.
   * @returns Имена, которых нет в папке.
   */
  async pull(folder: string, names: readonly string[]): Promise<string[]> {
    const drive = await this.connect()
    const folderId = await this.requireFolder(drive, folder)
    const dir = this.dir(folder)
    fs.mkdirSync(dir, { recursive: true })
    const meta = this.readMeta(dir)
    const missing: string[] = []
    for (const name of names) {
      const [file] = await drive.find(folderId, name)
      if (!file) {
        missing.push(name)
        continue
      }
      if (file.mimeType !== XLSX_MIME && !file.name.toLowerCase().endsWith('.xlsx')) throw new MessageError(message('drive.notXlsx', { file: name }))
      const local = path.join(dir, name)
      const known = meta[name]
      if (known && known.id === file.id && known.version === file.version && fs.existsSync(local) && md5Of(fs.readFileSync(local)) === known.md5) continue
      const bytes = await drive.download(file.id)
      fs.writeFileSync(`${local}.download`, bytes)
      fs.renameSync(`${local}.download`, local)
      meta[name] = { id: file.id, version: file.version ?? '', md5: md5Of(bytes) }
    }
    this.writeMeta(dir, meta)
    return missing
  }

  /**
   * Ставит блокировки на таблицы на время прогона с записью.
   * @throws {MessageError} `drive.busy` — таблицу сейчас пишет другое устройство (прогон повторится).
   */
  async lock(folder: string, names: readonly string[]): Promise<void> {
    const drive = await this.connect()
    const folderId = await this.requireFolder(drive, folder)
    try {
      for (const name of names) {
        const lockName = `${name}.lock`
        // брошенные блокировки и свои, оставшиеся от оборванного прогона, снимаем
        const leftovers = (await drive.find(folderId, lockName))
          .filter((file) => file.appProperties?.[LOCK_OWNER_PROPERTY] === this.owner || this.now() - createdMs(file) > LOCK_STALE_MS)
        for (const stale of leftovers) await drive.remove(stale.id)
        const others = await drive.find(folderId, lockName)
        if (others.length) throw new MessageError(message('drive.busy', { file: name, owner: others[0]!.appProperties?.[LOCK_OWNER_PROPERTY] ?? '—' }))
        const mine = await drive.create(folderId, lockName, Buffer.from(this.owner), 'text/plain', { [LOCK_OWNER_PROPERTY]: this.owner })
        this.locks.set(name, mine)
        // две программы могли поставить блокировку одновременно: побеждает самая ранняя
        const contenders = (await drive.find(folderId, lockName)).sort((a, b) => createdMs(a) - createdMs(b) || a.id.localeCompare(b.id))
        if (contenders[0] && contenders[0].id !== mine.id) {
          throw new MessageError(message('drive.busy', { file: name, owner: contenders[0].appProperties?.[LOCK_OWNER_PROPERTY] ?? '—' }))
        }
      }
    } catch (error) {
      await this.release()
      throw error
    }
  }

  /** Снимает свои блокировки (ошибки не мешают: брошенная блокировка устареет сама). */
  async release(): Promise<void> {
    if (!this.locks.size) return
    const locks = [...this.locks.values()]
    this.locks.clear()
    try {
      const drive = await this.connect()
      for (const lock of locks) await drive.remove(lock.id).catch(() => undefined)
    } catch {
      // нет связи — блокировки устареют сами
    }
  }

  /**
   * Выгружает таблицы, которые изменил движок.
   * @param stamp Метка копии прежних версий в `backups`.
   * @param backupDays Сколько дней хранить копии.
   * @returns Выгруженные и пропущенные (таблицу изменили на Drive после скачивания) имена.
   */
  async push(folder: string, names: readonly string[], stamp: string, backupDays: number): Promise<{ uploaded: string[]; conflicts: string[] }> {
    const dir = this.dir(folder)
    const meta = this.readMeta(dir)
    const changed = names.filter((name) => {
      const local = path.join(dir, name)
      return meta[name] && fs.existsSync(local) && md5Of(fs.readFileSync(local)) !== meta[name].md5
    })
    const result = { uploaded: [] as string[], conflicts: [] as string[] }
    if (!changed.length) return result
    const drive = await this.connect()
    const folderId = await this.requireFolder(drive, folder)
    let backupsId: string | null = null
    for (const name of changed) {
      const known = meta[name]!
      const current = await drive.get(known.id)
      if (!current || current.version !== known.version) {
        result.conflicts.push(name)
        continue
      }
      backupsId ??= await this.backupFolder(drive, folderId)
      await drive.copy(known.id, backupsId, `${stamp}_${name}`)
      const bytes = fs.readFileSync(path.join(dir, name))
      const saved = await drive.update(known.id, bytes, XLSX_MIME)
      const expected = md5Of(bytes)
      if (saved.md5Checksum && saved.md5Checksum !== expected) throw new MessageError(message('drive.verifyFailed', { file: name }))
      meta[name] = { id: known.id, version: saved.version ?? '', md5: expected }
      this.writeMeta(dir, meta)
      result.uploaded.push(name)
    }
    if (backupsId) await this.pruneBackups(drive, backupsId, backupDays)
    return result
  }

  /**
   * Выкладывает файл этого компьютера на место таблицы `name` (мост с телефонами: Probe → копия на Drive);
   * таблицы нет — создаёт. Заменяется только версия, известная копии (скачанная или выложенная этой программой),
   * прежняя — в `backups`. Блокировку ставит вызывающий.
   * @returns MD5 таблицы на Drive после выкладки.
   * @throws {MessageError} `drive.conflict` — таблицу изменили после скачивания (сначала её нужно перенести).
   */
  async publish(folder: string, name: string, source: string, stamp: string, backupDays: number): Promise<string> {
    const drive = await this.connect()
    const folderId = await this.requireFolder(drive, folder)
    const dir = this.dir(folder)
    fs.mkdirSync(dir, { recursive: true })
    const meta = this.readMeta(dir)
    const bytes = fs.readFileSync(source)
    const md5 = md5Of(bytes)
    const [file] = await drive.find(folderId, name)
    let saved: DriveFile
    if (!file) saved = await drive.create(folderId, name, bytes, XLSX_MIME)
    else {
      const known = meta[name]
      if (!known || known.id !== file.id || known.version !== file.version) throw new MessageError(message('drive.conflict', { file: name }))
      if (file.md5Checksum === md5) return md5
      const backupsId = await this.backupFolder(drive, folderId)
      await drive.copy(file.id, backupsId, `${stamp}_${name}`)
      saved = await drive.update(file.id, bytes, XLSX_MIME)
      await this.pruneBackups(drive, backupsId, backupDays)
    }
    if (saved.md5Checksum && saved.md5Checksum !== md5) throw new MessageError(message('drive.verifyFailed', { file: name }))
    fs.writeFileSync(path.join(dir, name), bytes)
    meta[name] = { id: saved.id, version: saved.version ?? '', md5 }
    this.writeMeta(dir, meta)
    return md5
  }

  /** «Версия:размер» таблицы на Drive (для слежения за Consum) или `null`, если её нет. */
  async remoteStamp(folder: string, name: string): Promise<string | null> {
    const drive = await this.connect()
    const [file] = await drive.find(await this.requireFolder(drive, folder), name)
    return file ? `${file.version ?? ''}:${file.size ?? ''}` : null
  }

  /** Метаданные таблицы на Drive (для проверки на вкладке «Хранилище»). */
  async remoteFile(folder: string, name: string): Promise<DriveFile | null> {
    const drive = await this.connect()
    const [file] = await drive.find(await this.requireFolder(drive, folder), name)
    return file ?? null
  }

  /**
   * Id папки таблиц; проверяет, что она есть и это папка.
   * @throws {MessageError} `drive.folderNotFound`.
   */
  private async requireFolder(drive: DriveClient, folder: string): Promise<string> {
    const id = parseDriveFolder(folder)
    const found = await drive.get(id)
    if (!found || found.mimeType !== FOLDER_MIME) throw new MessageError(message('drive.folderNotFound', { folder: folder.trim() || 'My Drive' }))
    return id
  }

  /** Id папки `backups` рядом с таблицами (создаётся при первой записи). */
  private async backupFolder(drive: DriveClient, folderId: string): Promise<string> {
    const [found] = await drive.find(folderId, BACKUP_FOLDER, FOLDER_MIME)
    return found ? found.id : (await drive.createFolder(folderId, BACKUP_FOLDER)).id
  }

  /** Удаляет копии старше `backupDays` дней (сбой не мешает записи). */
  private async pruneBackups(drive: DriveClient, backupsId: string, backupDays: number): Promise<void> {
    try {
      const old = (await drive.children(backupsId)).filter((file) => file.mimeType !== FOLDER_MIME && this.now() - createdMs(file) > backupDays * DAY_MS)
      for (const file of old) await drive.remove(file.id)
    } catch (error) {
      if (!(error instanceof DriveError)) throw error
    }
  }

  private readMeta(dir: string): Record<string, FileMeta> {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, META_FILE), 'utf8')) as Record<string, FileMeta>
    } catch {
      return {}
    }
  }

  private writeMeta(dir: string, meta: Record<string, FileMeta>): void {
    fs.writeFileSync(path.join(dir, META_FILE), JSON.stringify(meta, null, 2))
  }
}
