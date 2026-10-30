/**
 * Поддельный Google Drive в памяти для проверок (`drive.test.ts`, `phoneBridge.test.ts`): папки, файлы с версиями,
 * время создания — столько API, сколько нужно `DriveMirror`.
 */
import crypto from 'node:crypto'
import { FOLDER_MIME, XLSX_MIME, type DriveFile } from '../src/host/drive/DriveClient'
import { DRIVE_ROOT } from '../src/host/drive/DriveMirror'

/** Id папки таблиц. */
export const FOLDER = '1AbCdEfGhIjKlMnOpQ'

/** Поддельный Drive в памяти: папки, файлы с версиями, время создания. */
export class FakeDrive {
  readonly files = new Map<string, DriveFile & { parent: string; bytes: Uint8Array }>()
  downloads = 0
  now = Date.UTC(2026, 9, 30, 10)
  private nextId = 1

  constructor() {
    this.put(FOLDER, DRIVE_ROOT, 'Tables', new Uint8Array(), FOLDER_MIME)
  }

  put(id: string, parent: string, name: string, bytes: Uint8Array, mimeType = XLSX_MIME, appProperties?: Record<string, string>, createdAt = this.now) {
    const md5Checksum = mimeType === FOLDER_MIME ? undefined : crypto.createHash('md5').update(bytes).digest('hex')
    const file = { id, parent, name, bytes, mimeType, md5Checksum, size: String(bytes.length), version: '1', createdTime: new Date(createdAt).toISOString(), modifiedTime: new Date(this.now).toISOString(), appProperties }
    this.files.set(id, file)
    return file
  }

  /** Меняет файл, как другое устройство: новая версия. */
  edit(id: string, bytes: Uint8Array) {
    const file = this.files.get(id)!
    Object.assign(file, { bytes, md5Checksum: crypto.createHash('md5').update(bytes).digest('hex'), version: String(Number(file.version) + 1) })
  }

  byName(name: string, parent = FOLDER) {
    return [...this.files.values()].filter((file) => file.parent === parent && file.name === name)
  }

  async get(id: string) { return this.files.get(id) ?? null }
  async find(parent: string, name: string, mimeType?: string) { return this.byName(name, parent).filter((file) => !mimeType || file.mimeType === mimeType) }
  async children(parent: string) { return [...this.files.values()].filter((file) => file.parent === parent) }
  async download(id: string) { this.downloads++; return this.files.get(id)!.bytes }
  async create(parent: string, name: string, bytes: Uint8Array, mimeType: string, appProperties?: Record<string, string>) { return this.put(`n${this.nextId++}`, parent, name, bytes, mimeType, appProperties) }
  async update(id: string, bytes: Uint8Array) { this.edit(id, bytes); return this.files.get(id)! }
  async copy(id: string, parent: string, name: string) { return this.put(`c${this.nextId++}`, parent, name, this.files.get(id)!.bytes) }
  async createFolder(parent: string, name: string) { return this.put(`f${this.nextId++}`, parent, name, new Uint8Array(), FOLDER_MIME) }
  async remove(id: string) { this.files.delete(id) }
}
