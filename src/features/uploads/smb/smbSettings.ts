/**
 * Разбор настроек сетевого диска из вкладки «Хранилище» в параметры подключения и пути на общей папке.
 */
import type { SmbSettings } from '@/features/settings/store/settingsSchema'
import { UploadError } from '../UploadError'
import { BACKUP_FOLDER } from '../xlsx/BackupPolicy'
import type { SmbConnection } from './SmbShare'

/** Порт SMB по умолчанию. */
export const SMB_DEFAULT_PORT = 445

/** Расширение таблицы. */
export const TABLE_EXTENSION = '.xlsx'

/** Адрес сервера с портом. */
export interface SmbEndpoint {
  /** Имя или IP-адрес. */
  host: string
  /** TCP-порт. */
  port: number
}

/** Проверяет порт и собирает адрес. */
function endpoint(host: string, port: string | undefined): SmbEndpoint | null {
  if (!host) return null
  if (port === undefined) return { host, port: SMB_DEFAULT_PORT }
  const number = Number(port)
  return Number.isInteger(number) && number >= 1 && number <= 65535 ? { host, port: number } : null
}

/**
 * Разбирает поле «Сервер»: `fileserver`, `10.0.0.5`, `10.0.0.5:1445`, `[fe80::1]:445`;
 * терпит `smb://` и ведущие `\\`, а также случайно дописанный `\share`.
 * @returns `null`, если адрес пустой или порт некорректен.
 */
export function parseSmbHost(input: string): SmbEndpoint | null {
  const text = input.trim().replace(/^(?:smb|cifs):\/\//i, '').replace(/^[\\/]+/, '').split(/[\\/]/)[0] ?? ''
  if (!text) return null
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(text)
  if (bracketed) return endpoint(bracketed[1]!, bracketed[2])
  const parts = text.split(':')
  if (parts.length === 1) return endpoint(text, undefined)
  if (parts.length === 2) return endpoint(parts[0]!, parts[1])
  // IPv6 без скобок: порт указать нельзя.
  return endpoint(text, undefined)
}

/**
 * Приводит путь внутри общей папки к виду `папка/файл`: `\` → `/`, без ведущих и конечных
 * слэшей, без пустых сегментов и `.`.
 * @throws {UploadError} `invalidPath`, если путь выходит наружу через `..`.
 */
export function normalizeSharePath(input: string): string {
  const segments = input.replace(/\\/g, '/').split('/').map((segment) => segment.trim()).filter((segment) => segment !== '' && segment !== '.')
  if (segments.includes('..')) throw new UploadError('invalidPath', { path: input })
  return segments.join('/')
}

/** Заполнены ли поля, без которых подключиться нельзя (пароль и домен могут быть пустыми). */
export const isSmbConfigured = (smb: SmbSettings) =>
  parseSmbHost(smb.host) !== null && smb.share.trim() !== '' && smb.filePath.trim() !== ''

/**
 * Параметры подключения из настроек.
 * @throws {UploadError} `notConfigured`, если сервер, папка или путь не заданы.
 */
export function resolveSmbConnection(smb: SmbSettings): SmbConnection {
  const server = parseSmbHost(smb.host)
  const share = smb.share.trim().replace(/^[\\/]+|[\\/]+$/g, '')
  if (!server || !share || smb.filePath.trim() === '') throw new UploadError('notConfigured')
  return { host: server.host, port: server.port, share, domain: smb.domain.trim(), username: smb.username.trim(), password: smb.password }
}

/** Пути, с которыми работает запись одной таблицы. */
export interface TablePaths {
  /** Сама таблица, например `Somascan/labels.xlsx`. */
  target: string
  /** Папка таблицы (`''` — корень общей папки). */
  dir: string
  /** Имя файла с расширением. */
  name: string
  /** Имя без расширения — префикс резервных копий. */
  stem: string
  /** Временный файл, в который пишется новая версия перед заменой. */
  tmp: string
  /** Папка-блокировка: пока она есть, таблицу пишет другое устройство. */
  lock: string
  /** Папка резервных копий рядом с таблицей. */
  backupDir: string
}

/**
 * Пути для таблицы по полю «Путь к таблице».
 * @throws {UploadError} `invalidPath`, если путь не оканчивается на `.xlsx`.
 */
export function tablePaths(filePath: string): TablePaths {
  const target = normalizeSharePath(filePath)
  if (!target.toLowerCase().endsWith(TABLE_EXTENSION)) throw new UploadError('invalidPath', { path: filePath })
  const slash = target.lastIndexOf('/')
  const dir = slash >= 0 ? target.slice(0, slash) : ''
  const name = target.slice(slash + 1)
  const stem = name.slice(0, -TABLE_EXTENSION.length)
  if (stem === '') throw new UploadError('invalidPath', { path: filePath })
  const inDir = (child: string) => (dir ? `${dir}/${child}` : child)
  return { target, dir, name, stem, tmp: inDir(`${name}.tmp`), lock: inDir(`${name}.lock`), backupDir: inDir(BACKUP_FOLDER) }
}
