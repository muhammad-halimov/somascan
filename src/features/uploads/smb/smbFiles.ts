/**
 * Сетевой диск Windows (SMB): типы, контракт файловых операций и разбор отказов нативной части.
 *
 * Операции выполняет нативный код (Android — smbj, iOS — AMSMB2). В приложении к нему ходят через
 * плагин Capacitor (`SmbShare.ts`), в движке очереди — через его хост (`src/engine/HostSmbShare.ts`);
 * коды отказов у обоих одни и те же. Пути — относительно корня общей папки, через `/`.
 */
import { UploadError, type UploadErrorCode } from '../UploadError'

/** Параметры подключения к общей папке. */
export interface SmbConnection {
  /** Имя сервера или IP-адрес. */
  host: string
  /** TCP-порт (обычно 445). */
  port: number
  /** Имя общей папки. */
  share: string
  /** Домен Windows или пустая строка. */
  domain: string
  /** Имя учётной записи. */
  username: string
  /** Пароль. */
  password: string
}

/** Элемент списка папки. */
export interface SmbEntry {
  /** Имя файла или папки (без пути). */
  name: string
  /** Это папка. */
  isDirectory: boolean
  /** Размер в байтах (у папок 0). */
  size: number
  /** Время последнего изменения (мс с начала эпохи). */
  modifiedAt: number
}

/** Сведения о файле или папке. */
export interface SmbStat {
  /** Существует ли путь. */
  exists: boolean
  /** Это папка. */
  isDirectory: boolean
  /** Размер в байтах. */
  size: number
  /** Время последнего изменения (мс с начала эпохи). */
  modifiedAt: number
}

/** Результат атомарной замены файла. */
export interface SmbCommitResult {
  /** SHA-256 записанного файла (hex), посчитанный нативной частью после перечитывания. */
  hash: string
  /** Размер итогового файла в байтах. */
  size: number
}

/** Файловые операции на общей папке с ошибками в виде `UploadError`. */
export interface SmbFiles {
  /** Сведения о файле или папке; `exists: false`, если пути нет. */
  probe(connection: SmbConnection, path: string): Promise<SmbStat>
  /** Читает файл целиком. */
  read(connection: SmbConnection, path: string): Promise<Uint8Array>
  /** Создаёт файл или перезаписывает существующий. */
  write(connection: SmbConnection, path: string, bytes: Uint8Array): Promise<void>
  /**
   * Атомарно заменяет файл: пишет временный файл рядом, перечитывает его и сверяет SHA-256,
   * прежний файл переименовывает в `backupPath` (если задан), временный — в `path`.
   */
  commit(connection: SmbConnection, path: string, bytes: Uint8Array, backupPath?: string): Promise<SmbCommitResult>
  /** Переименовывает файл или папку; цель не должна существовать. */
  rename(connection: SmbConnection, from: string, to: string): Promise<void>
  /** Удаляет файл или папку (папку — со всем содержимым). */
  remove(connection: SmbConnection, path: string): Promise<void>
  /** Содержимое папки (без `.` и `..`). */
  list(connection: SmbConnection, path: string): Promise<SmbEntry[]>
  /** Создаёт одну папку; если она уже есть — ошибка `exists` (на этом строится блокировка). */
  mkdir(connection: SmbConnection, path: string): Promise<void>
  /** Создаёт папку вместе с родительскими; существующие пропускает. */
  mkdirs(connection: SmbConnection, path: string): Promise<void>
}

/** Коды, которые нативные плагины передают через `call.reject(message, code)`. */
const NATIVE_CODES: readonly UploadErrorCode[] = [
  'hostUnreachable', 'timeout', 'authFailed', 'shareNotFound', 'notFound', 'exists', 'accessDenied', 'locked', 'verifyFailed', 'io',
]

/** Превращает отказ плагина в `UploadError` с кодом из нативной части. */
export function toSmbError(error: unknown, connection: SmbConnection): UploadError {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  // Отказ плагина — Error, отказ хоста движка — объект `{ code, message }`.
  const message = typeof error === 'object' && error !== null ? (error as { message?: unknown }).message : undefined
  const detail = typeof message === 'string' ? message : String(error)
  const params = { detail, host: connection.host, share: connection.share }
  // Capacitor отвечает так, когда плагин не зарегистрирован на платформе (браузер, старая сборка).
  if (code === 'UNIMPLEMENTED') return new UploadError('unavailable', params)
  const known = NATIVE_CODES.find((candidate) => candidate === code)
  return new UploadError(known ?? 'io', params)
}
