/**
 * Отметки устройств об использовании LM Studio (`ModelUseGate`) — в хранилище таблицы, рядом с журналом:
 * все телефоны площадки пишут в один журнал, значит, видят одну и ту же папку.
 *
 * - Сетевой диск: папка `somascan-lmstudio` рядом с таблицей, в ней `<id устройства>.json`.
 * - Google Drive: файлы `somascan-lmstudio-<id устройства>` в папке таблицы; отметка — в метках
 *   приложения (`appProperties`), поэтому весь список читается одним запросом. Снятая отметка — та же
 *   метка с истёкшим сроком: файл не удаляется и не создаётся заново на каждое распознавание.
 */
import { Capacitor } from '@capacitor/core'
import type { Lease, LeaseBoard, LeaseKind } from '@/features/recognition/catalog/ModelUseGate'
import type { StorageSettings } from '@/features/settings/store/settingsSchema'
import { DriveClient } from '../drive/DriveClient'
import { isDriveConfigured, parseDriveFolder } from '../drive/driveSettings'
import type { SmbConnection, SmbFiles } from '../smb/smbFiles'
import { isSmbConfigured, resolveSmbConnection, tablePaths } from '../smb/smbSettings'
import { UploadError } from '../UploadError'
import type { TableBackendDeps } from '../worker/tableBackends'

/** Папка отметок на сетевом диске (рядом с таблицей). */
export const SMB_LEASE_FOLDER = 'somascan-lmstudio'

/** Начало имени файла отметки в Google Drive. */
export const DRIVE_LEASE_PREFIX = 'somascan-lmstudio-'

/** Расширение файла отметки на сетевом диске. */
const LEASE_EXTENSION = '.json'

const KINDS: readonly LeaseKind[] = ['using', 'switching']

/** Отметка из сохранённых полей; повреждённая — `null`. */
export function parseLease(device: string, fields: unknown): Lease | null {
  if (!device || typeof fields !== 'object' || fields === null) return null
  const { kind, server, until } = fields as Record<string, unknown>
  const deadline = typeof until === 'string' ? Number(until) : until
  if (!KINDS.includes(kind as LeaseKind) || typeof server !== 'string' || typeof deadline !== 'number' || !Number.isFinite(deadline)) return null
  return { device, kind: kind as LeaseKind, server, until: deadline }
}

const isNotFound = (error: unknown) => error instanceof UploadError && error.code === 'notFound'

/** Отметки на сетевом диске: по файлу `<устройство>.json` в папке отметок. */
export class SmbLeaseBoard implements LeaseBoard {
  private readonly files: SmbFiles
  private readonly connection: SmbConnection
  private readonly dir: string

  /**
   * @param files Файловые операции на общей папке.
   * @param connection Подключение.
   * @param dir Папка отметок внутри общей папки.
   */
  constructor(files: SmbFiles, connection: SmbConnection, dir: string) {
    this.files = files
    this.connection = connection
    this.dir = dir
  }

  async list(): Promise<Lease[]> {
    let entries
    try {
      entries = await this.files.list(this.connection, this.dir)
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
    const leases = await Promise.all(entries
      .filter((entry) => !entry.isDirectory && entry.name.endsWith(LEASE_EXTENSION))
      .map(async (entry) => {
        try {
          const text = new TextDecoder().decode(await this.files.read(this.connection, `${this.dir}/${entry.name}`))
          return parseLease(entry.name.slice(0, -LEASE_EXTENSION.length), JSON.parse(text))
        } catch {
          // Файл удалили между списком и чтением или он недописан — отметки нет.
          return null
        }
      }))
    return leases.filter((lease): lease is Lease => lease !== null)
  }

  async put({ device, kind, server, until }: Lease): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify({ kind, server, until }))
    const path = this.pathOf(device)
    try {
      await this.files.write(this.connection, path, bytes)
    } catch (error) {
      if (!isNotFound(error)) throw error
      // Первая отметка в этой папке: создаём папку отметок.
      await this.files.mkdirs(this.connection, this.dir)
      await this.files.write(this.connection, path, bytes)
    }
  }

  async remove(device: string): Promise<void> {
    try {
      await this.files.remove(this.connection, this.pathOf(device))
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  }

  private pathOf(device: string) {
    return `${this.dir}/${device}${LEASE_EXTENSION}`
  }
}

/** Отметки в Google Drive: файл на устройство, отметка — в его метках приложения. */
export class DriveLeaseBoard implements LeaseBoard {
  private readonly client: () => Promise<DriveClient>
  private readonly folderId: string
  /** Id своего файла отметки, когда он уже известен. */
  private ownId: string | null = null

  /**
   * @param client Клиент Drive со свежим токеном.
   * @param folderId Папка таблицы.
   */
  constructor(client: () => Promise<DriveClient>, folderId: string) {
    this.client = client
    this.folderId = folderId
  }

  async list(): Promise<Lease[]> {
    const files = await (await this.client()).findByPrefix(this.folderId, DRIVE_LEASE_PREFIX)
    return files
      .map((file) => parseLease(file.name.slice(DRIVE_LEASE_PREFIX.length), file.appProperties))
      .filter((lease): lease is Lease => lease !== null)
  }

  async put({ device, kind, server, until }: Lease): Promise<void> {
    await this.save(device, { kind, server, until: String(until) })
  }

  /** Снимает отметку: срок — в прошлом (файл остаётся для следующей отметки). */
  async remove(device: string): Promise<void> {
    const drive = await this.client()
    const id = this.ownId ?? (await drive.find(this.folderId, DRIVE_LEASE_PREFIX + device))[0]?.id
    if (!id) return
    try {
      await drive.setProperties(id, { until: '0' })
    } catch (error) {
      if (!isNotFound(error)) throw error
      this.ownId = null
    }
  }

  /** Записывает метки своего файла, создавая его при первой отметке. */
  private async save(device: string, properties: Record<string, string>) {
    const drive = await this.client()
    const name = DRIVE_LEASE_PREFIX + device
    this.ownId ??= (await drive.find(this.folderId, name))[0]?.id ?? null
    if (this.ownId) {
      try {
        await drive.setProperties(this.ownId, properties)
        return
      } catch (error) {
        if (!isNotFound(error)) throw error
        this.ownId = null
      }
    }
    this.ownId = (await drive.create(this.folderId, name, new Uint8Array(), 'text/plain', properties)).id
  }
}

/**
 * Отметки по настройкам «Хранилище»: та же папка, где журнал.
 * @returns `null`, если хранилище не настроено (или сетевой диск — в браузере, где его нет).
 * @throws {UploadError} Путь к таблице или папка Drive некорректны.
 */
export function leaseBoardFor(storage: StorageSettings, deps: TableBackendDeps): LeaseBoard | null {
  if (storage.target === 'smb') {
    if (!Capacitor.isNativePlatform() || !isSmbConfigured(storage.smb)) return null
    const { dir } = tablePaths(storage.smb.filePath)
    return new SmbLeaseBoard(deps.smb, resolveSmbConnection(storage.smb), dir ? `${dir}/${SMB_LEASE_FOLDER}` : SMB_LEASE_FOLDER)
  }
  if (!isDriveConfigured(storage.googleDrive)) return null
  const folderId = parseDriveFolder(storage.googleDrive.folder)
  return new DriveLeaseBoard(async () => new DriveClient(await deps.google.accessToken(), deps.fetch), folderId)
}
