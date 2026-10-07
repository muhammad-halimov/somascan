/**
 * Хранилище таблицы по настройкам «Хранилище»: сетевой диск или Google Drive.
 */
import type { StorageSettings } from '@/features/settings/store/settingsSchema'
import { DriveClient } from '../drive/DriveClient'
import { DriveTableBackend } from '../drive/DriveTableBackend'
import { parseDriveFileName, parseDriveFolder } from '../drive/driveSettings'
import type { GoogleDriveSession } from '../drive/GoogleDriveAuth'
import { UploadError } from '../UploadError'
import { SmbShareClient } from '../smb/SmbShare'
import { resolveSmbConnection, tablePaths } from '../smb/smbSettings'
import { SmbTableBackend } from '../smb/SmbTableBackend'
import type { TableBackend } from './TableBackend'

/** Откуда брать доступ к хранилищам. */
export interface TableBackendDeps {
  /** Файловые операции на сетевом диске. */
  smb: SmbShareClient
  /** Вход в Google (токены Drive). */
  google: GoogleDriveSession
}

/**
 * Хранилище для текущих настроек.
 * @throws {UploadError} `notConfigured`, `invalidPath`, `authRequired` и т. п. — если писать некуда.
 */
export async function backendFor(storage: StorageSettings, deps: TableBackendDeps): Promise<TableBackend> {
  if (storage.target === 'smb') {
    return new SmbTableBackend(deps.smb, resolveSmbConnection(storage.smb), tablePaths(storage.smb.filePath))
  }
  if (!storage.googleDrive.account) throw new UploadError('authRequired')
  const folderId = parseDriveFolder(storage.googleDrive.folder)
  const name = parseDriveFileName(storage.googleDrive.fileName)
  return new DriveTableBackend(new DriveClient(await deps.google.accessToken()), folderId, name)
}

/** Хранилища по умолчанию (нативные плагины). */
export const defaultBackendDeps = (google: GoogleDriveSession): TableBackendDeps => ({ smb: new SmbShareClient(), google })
