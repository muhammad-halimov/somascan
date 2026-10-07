/**
 * Сетевой диск Windows (SMB) — типизированная обёртка над локальным плагином `SmbShare`
 * (`android/.../SmbSharePlugin.java`, `ios/App/App/SmbSharePlugin.swift`).
 *
 * WebView не умеет говорить по SMB, поэтому файлы читает и пишет нативная часть:
 * Android — библиотека smbj, iOS — AMSMB2 (libsmb2). Содержимое файлов ходит через мост
 * строкой base64. Пути — относительно корня общей папки, через `/`, без ведущего слэша;
 * плагины сами переводят их в формат своей библиотеки.
 *
 * Каждая операция открывает соединение заново или берёт его из кэша плагина; нативная часть
 * выполняет операции строго по одной (одна очередь), так что параллельных обращений к серверу нет.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { base64ToBytes, bytesToBase64 } from '@/lib/encoding/base64'
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

/** Контракт нативного плагина. */
interface SmbSharePlugin {
  probe(options: { connection: SmbConnection; path: string }): Promise<SmbStat>
  read(options: { connection: SmbConnection; path: string }): Promise<{ data: string }>
  write(options: { connection: SmbConnection; path: string; data: string }): Promise<void>
  commit(options: { connection: SmbConnection; path: string; data: string; backupPath?: string }): Promise<SmbCommitResult>
  rename(options: { connection: SmbConnection; from: string; to: string }): Promise<void>
  remove(options: { connection: SmbConnection; path: string }): Promise<void>
  list(options: { connection: SmbConnection; path: string }): Promise<{ entries: SmbEntry[] }>
  mkdir(options: { connection: SmbConnection; path: string }): Promise<void>
  mkdirs(options: { connection: SmbConnection; path: string }): Promise<void>
}

/** Плагин есть только в нативных сборках. */
const SmbShare = registerPlugin<SmbSharePlugin>('SmbShare')

/** Коды, которые нативные плагины передают через `call.reject(message, code)`. */
const NATIVE_CODES: readonly UploadErrorCode[] = [
  'hostUnreachable', 'timeout', 'authFailed', 'shareNotFound', 'notFound', 'exists', 'accessDenied', 'locked', 'verifyFailed', 'io',
]

/** Превращает отказ плагина в `UploadError` с кодом из нативной части. */
function toSmbError(error: unknown, connection: SmbConnection): UploadError {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  const detail = error instanceof Error ? error.message : String(error)
  const params = { detail, host: connection.host, share: connection.share }
  // Capacitor отвечает так, когда плагин не зарегистрирован на платформе (браузер, старая сборка).
  if (code === 'UNIMPLEMENTED') return new UploadError('unavailable', params)
  const known = NATIVE_CODES.find((candidate) => candidate === code)
  return new UploadError(known ?? 'io', params)
}

/** Файловые операции на общей папке с ошибками в виде `UploadError`. */
export class SmbShareClient {
  /** Сведения о файле или папке; `exists: false`, если пути нет. */
  probe(connection: SmbConnection, path: string): Promise<SmbStat> {
    return this.call(connection, () => SmbShare.probe({ connection, path }))
  }

  /** Читает файл целиком. */
  async read(connection: SmbConnection, path: string): Promise<Uint8Array> {
    const { data } = await this.call(connection, () => SmbShare.read({ connection, path }))
    return base64ToBytes(data)
  }

  /** Создаёт файл или перезаписывает существующий. */
  write(connection: SmbConnection, path: string, bytes: Uint8Array): Promise<void> {
    return this.call(connection, () => SmbShare.write({ connection, path, data: bytesToBase64(bytes) }))
  }

  /**
   * Атомарно заменяет файл: пишет временный файл рядом, перечитывает его и сверяет SHA-256,
   * прежний файл переименовывает в `backupPath` (если задан), временный — в `path`.
   * Выполняется одним нативным вызовом, чтобы не прерываться при уходе приложения в фон.
   */
  commit(connection: SmbConnection, path: string, bytes: Uint8Array, backupPath?: string): Promise<SmbCommitResult> {
    return this.call(connection, () => SmbShare.commit({ connection, path, data: bytesToBase64(bytes), backupPath }))
  }

  /** Переименовывает файл или папку; цель не должна существовать. */
  rename(connection: SmbConnection, from: string, to: string): Promise<void> {
    return this.call(connection, () => SmbShare.rename({ connection, from, to }))
  }

  /** Удаляет файл или папку (папку — со всем содержимым). */
  remove(connection: SmbConnection, path: string): Promise<void> {
    return this.call(connection, () => SmbShare.remove({ connection, path }))
  }

  /** Содержимое папки (без `.` и `..`). */
  async list(connection: SmbConnection, path: string): Promise<SmbEntry[]> {
    const { entries } = await this.call(connection, () => SmbShare.list({ connection, path }))
    return entries
  }

  /** Создаёт одну папку; если она уже есть — ошибка `exists` (на этом строится блокировка). */
  mkdir(connection: SmbConnection, path: string): Promise<void> {
    return this.call(connection, () => SmbShare.mkdir({ connection, path }))
  }

  /** Создаёт папку вместе с родительскими; существующие пропускает. */
  mkdirs(connection: SmbConnection, path: string): Promise<void> {
    return this.call(connection, () => SmbShare.mkdirs({ connection, path }))
  }

  /** Вызывает плагин, превращая отказ в `UploadError`; в браузере плагина нет. */
  private async call<T>(connection: SmbConnection, invoke: () => Promise<T>): Promise<T> {
    if (!Capacitor.isNativePlatform()) throw new UploadError('unavailable', { host: connection.host, share: connection.share })
    try {
      return await invoke()
    } catch (error) {
      throw toSmbError(error, connection)
    }
  }
}
