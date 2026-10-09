/**
 * Сетевой диск для движка очереди: те же операции, что у плагина `SmbShare`, но через хост
 * (`smb` → нативный SmbShareClient: Android — smbj, iOS — AMSMB2). Аргументы и коды отказов
 * совпадают с плагином, содержимое файлов — base64.
 */
import { base64ToBytes, bytesToBase64 } from '@/lib/encoding/base64'
import { toSmbError, type SmbCommitResult, type SmbConnection, type SmbEntry, type SmbFiles, type SmbStat } from '@/features/uploads/smb/smbFiles'
import { host } from './host'

/** Операции на общей папке через хост движка. */
export class HostSmbShare implements SmbFiles {
  probe(connection: SmbConnection, path: string): Promise<SmbStat> {
    return this.call(connection, 'probe', { path })
  }

  async read(connection: SmbConnection, path: string): Promise<Uint8Array> {
    const { data } = await this.call<{ data: string }>(connection, 'read', { path })
    return base64ToBytes(data)
  }

  async write(connection: SmbConnection, path: string, bytes: Uint8Array): Promise<void> {
    await this.call(connection, 'write', { path, data: bytesToBase64(bytes) })
  }

  commit(connection: SmbConnection, path: string, bytes: Uint8Array, backupPath?: string): Promise<SmbCommitResult> {
    return this.call(connection, 'commit', { path, data: bytesToBase64(bytes), ...(backupPath ? { backupPath } : {}) })
  }

  async rename(connection: SmbConnection, from: string, to: string): Promise<void> {
    await this.call(connection, 'rename', { from, to })
  }

  async remove(connection: SmbConnection, path: string): Promise<void> {
    await this.call(connection, 'remove', { path })
  }

  async list(connection: SmbConnection, path: string): Promise<SmbEntry[]> {
    const { entries } = await this.call<{ entries: SmbEntry[] }>(connection, 'list', { path })
    return entries
  }

  async mkdir(connection: SmbConnection, path: string): Promise<void> {
    await this.call(connection, 'mkdir', { path })
  }

  async mkdirs(connection: SmbConnection, path: string): Promise<void> {
    await this.call(connection, 'mkdirs', { path })
  }

  /** Операция `op` у хоста; отказ — `UploadError` с кодом нативной части. */
  private async call<T>(connection: SmbConnection, op: string, args: Record<string, string>): Promise<T> {
    try {
      return await host.call<T>('smb', { op, connection, ...args })
    } catch (error) {
      throw toSmbError(error, connection)
    }
  }
}
