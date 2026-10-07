/**
 * Разбор настроек Google Drive: папка (ссылка или id) и имя таблицы.
 */
import type { GoogleDriveSettings } from '@/features/settings/store/settingsSchema'
import { UploadError } from '../UploadError'
import { TABLE_EXTENSION } from '../smb/smbSettings'

/** Корень «Моего диска» в Drive API. */
export const DRIVE_ROOT = 'root'

/**
 * Id папки из поля «Папка»: ссылка вида `https://drive.google.com/drive/folders/<id>?usp=…`
 * (в том числе `/drive/u/0/folders/<id>` и `?id=<id>`) или сам id. Пустое поле — корень «Моего диска».
 * @throws {UploadError} `invalidPath`, если из ссылки не удаётся достать id.
 */
export function parseDriveFolder(input: string): string {
  const text = input.trim()
  if (!text) return DRIVE_ROOT
  const fromPath = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(text)
  if (fromPath) return fromPath[1]!
  const fromQuery = /[?&]id=([A-Za-z0-9_-]{10,})/.exec(text)
  if (fromQuery) return fromQuery[1]!
  if (/^[A-Za-z0-9_-]{10,}$/.test(text)) return text
  throw new UploadError('invalidPath', { path: text })
}

/**
 * Имя таблицы из поля «Имя файла»: без папок, с расширением `.xlsx` (добавляется, если его нет).
 * @throws {UploadError} `invalidPath`, если имя пустое или содержит `/`.
 */
export function parseDriveFileName(input: string): string {
  const text = input.trim()
  if (!text || /[/\\]/.test(text)) throw new UploadError('invalidPath', { path: input })
  return text.toLowerCase().endsWith(TABLE_EXTENSION) ? text : `${text}${TABLE_EXTENSION}`
}

/** Можно ли писать в Drive: вход выполнен, имя файла задано, папка распознаётся. */
export function isDriveConfigured(drive: GoogleDriveSettings): boolean {
  if (!drive.account) return false
  try {
    parseDriveFolder(drive.folder)
    parseDriveFileName(drive.fileName)
    return true
  } catch {
    return false
  }
}
