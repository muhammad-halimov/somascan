/**
 * Поддельный сетевой диск в памяти — для проверки `SmbTableBackend` и движка очереди без сервера.
 * Ведёт себя как нативные клиенты (`SmbShareClient.java` / `.swift`): папки явные, запись и `mkdir`
 * без родительской папки — `notFound`, повторный `mkdir` — `exists`, `commit` — временный файл,
 * прежний — в копию, временный — в таблицу.
 */
import { createHash } from 'node:crypto'
import { UploadError } from '../src/features/uploads/UploadError'
import type { SmbCommitResult, SmbConnection, SmbEntry, SmbFiles, SmbStat } from '../src/features/uploads/smb/smbFiles'

/** Узел дерева. */
interface FakeNode {
  isDirectory: boolean
  bytes: Uint8Array
  modifiedAt: number
}

/** Нормализованный путь. */
const clean = (path: string) => path.split('/').filter(Boolean).join('/')

/** Родительская папка (`''` — корень). */
const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** Поддельная общая папка. */
export class FakeSmb implements SmbFiles {
  readonly nodes = new Map<string, FakeNode>()
  /** Текущее время сервера (мс). */
  now = Date.UTC(2026, 9, 7, 12, 0, 0)
  /** Журнал операций. */
  readonly log: string[] = []
  /** Вызывается перед каждой операцией (тест может «оборвать» запись или изменить файл). */
  beforeOperation?: (op: string, path: string) => void
  /**
   * Задержка операций по имени (мс), как у настоящего сервера: тесты, которым важно время
   * (плавный ход записи), не зависят от скорости машины.
   */
  latency: Partial<Record<string, number>> = {}

  /** Кладёт файл (с папками) напрямую. */
  put(path: string, bytes: Uint8Array) {
    this.mkdirsSync(parentOf(clean(path)))
    this.nodes.set(clean(path), { isDirectory: false, bytes, modifiedAt: this.now })
  }

  /** Байты файла или `undefined`. */
  file(path: string): Uint8Array | undefined {
    const node = this.nodes.get(clean(path))
    return node && !node.isDirectory ? node.bytes : undefined
  }

  async probe(_connection: SmbConnection, path: string): Promise<SmbStat> {
    await this.touch('probe', path)
    const node = this.nodes.get(clean(path))
    return node ? { exists: true, isDirectory: node.isDirectory, size: node.bytes.length, modifiedAt: node.modifiedAt } : { exists: false, isDirectory: false, size: 0, modifiedAt: 0 }
  }

  async read(_connection: SmbConnection, path: string): Promise<Uint8Array> {
    await this.touch('read', path)
    const node = this.nodes.get(clean(path))
    if (!node || node.isDirectory) throw new UploadError('notFound', { path })
    return node.bytes
  }

  async write(_connection: SmbConnection, path: string, bytes: Uint8Array): Promise<void> {
    await this.touch('write', path)
    this.requireDir(parentOf(clean(path)))
    this.nodes.set(clean(path), { isDirectory: false, bytes, modifiedAt: this.now })
  }

  async commit(_connection: SmbConnection, path: string, bytes: Uint8Array, backupPath?: string): Promise<SmbCommitResult> {
    await this.touch('commit', path)
    const target = clean(path)
    this.mkdirsSync(parentOf(target))
    this.nodes.set(`${target}.tmp`, { isDirectory: false, bytes, modifiedAt: this.now })
    const current = this.nodes.get(target)
    if (current) {
      if (backupPath) {
        this.mkdirsSync(parentOf(clean(backupPath)))
        this.nodes.set(clean(backupPath), current)
      }
      this.nodes.delete(target)
    }
    this.nodes.set(target, this.nodes.get(`${target}.tmp`)!)
    this.nodes.delete(`${target}.tmp`)
    return { hash: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
  }

  async rename(_connection: SmbConnection, from: string, to: string): Promise<void> {
    await this.touch('rename', from)
    if (this.nodes.has(clean(to))) throw new UploadError('exists', { path: to })
    for (const [key, node] of [...this.nodes]) {
      if (key === clean(from) || key.startsWith(`${clean(from)}/`)) {
        this.nodes.delete(key)
        this.nodes.set(clean(to) + key.slice(clean(from).length), node)
      }
    }
  }

  async remove(_connection: SmbConnection, path: string): Promise<void> {
    await this.touch('remove', path)
    if (!this.nodes.has(clean(path))) throw new UploadError('notFound', { path })
    for (const key of [...this.nodes.keys()]) if (key === clean(path) || key.startsWith(`${clean(path)}/`)) this.nodes.delete(key)
  }

  async list(_connection: SmbConnection, path: string): Promise<SmbEntry[]> {
    await this.touch('list', path)
    this.requireDir(clean(path))
    const prefix = clean(path) ? `${clean(path)}/` : ''
    return [...this.nodes].filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/') && key !== clean(path))
      .map(([key, node]) => ({ name: key.slice(prefix.length), isDirectory: node.isDirectory, size: node.bytes.length, modifiedAt: node.modifiedAt }))
  }

  async mkdir(_connection: SmbConnection, path: string): Promise<void> {
    await this.touch('mkdir', path)
    if (this.nodes.has(clean(path))) throw new UploadError('exists', { path })
    this.requireDir(parentOf(clean(path)))
    this.nodes.set(clean(path), { isDirectory: true, bytes: new Uint8Array(), modifiedAt: this.now })
  }

  async mkdirs(_connection: SmbConnection, path: string): Promise<void> {
    await this.touch('mkdirs', path)
    this.mkdirsSync(clean(path))
  }

  private async touch(op: string, path: string) {
    this.log.push(`${op} ${clean(path)}`)
    this.beforeOperation?.(op, clean(path))
    const delay = this.latency[op]
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
  }

  private requireDir(path: string) {
    if (path === '') return
    const node = this.nodes.get(path)
    if (!node || !node.isDirectory) throw new UploadError('notFound', { path })
  }

  private mkdirsSync(path: string) {
    let current = ''
    for (const segment of path.split('/').filter(Boolean)) {
      current = current ? `${current}/${segment}` : segment
      if (!this.nodes.has(current)) this.nodes.set(current, { isDirectory: true, bytes: new Uint8Array(), modifiedAt: this.now })
    }
  }
}
