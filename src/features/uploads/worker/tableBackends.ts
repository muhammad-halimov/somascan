/**
 * Хранилище таблицы по настройкам «Хранилище»: сетевой диск или Google Drive.
 *
 * Доступ к сетевому диску, токены Google и `fetch` передаются снаружи: в приложении — плагины
 * Capacitor и `fetch` WebView (`uploads/queue/appBackends.ts`), в движке очереди — нативный хост.
 */
import type { StorageSettings } from '@/features/settings/store/settingsSchema'
import { DriveClient } from '../drive/DriveClient'
import { DriveTableBackend } from '../drive/DriveTableBackend'
import { parseDriveFileName, parseDriveFolder } from '../drive/driveSettings'
import { UploadError } from '../UploadError'
import type { SmbFiles } from '../smb/smbFiles'
import { resolveSmbConnection, tablePaths } from '../smb/smbSettings'
import { SmbTableBackend } from '../smb/SmbTableBackend'
import type { TableBackend } from './TableBackend'

/** Источник токенов доступа к Drive. */
export interface DriveTokenSource {
  /** Свежий токен без участия пользователя; `authRequired`, если нужно войти заново. */
  accessToken(): Promise<string>
}

/** Откуда брать доступ к хранилищам. */
export interface TableBackendDeps {
  /** Файловые операции на сетевом диске. */
  smb: SmbFiles
  /** Вход в Google (токены Drive). */
  google: DriveTokenSource
  /** `fetch` для Drive API; по умолчанию — глобальный. */
  fetch?: typeof fetch
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
  return new DriveTableBackend(new DriveClient(await deps.google.accessToken(), deps.fetch), folderId, name)
}
