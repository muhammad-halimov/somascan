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
import { UploadError } from '../UploadError'
import { toSmbError, type SmbCommitResult, type SmbConnection, type SmbEntry, type SmbFiles, type SmbStat } from './smbFiles'

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

/** Файловые операции на общей папке через плагин Capacitor. */
export class SmbShareClient implements SmbFiles {
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

export type { SmbCommitResult, SmbConnection, SmbEntry, SmbStat } from './smbFiles'
