/**
 * Поддельный Google Drive API v3 в памяти — для проверки `DriveTableBackend` и `TableWriter`
 * без сети. Понимает только запросы, которые делает `DriveClient`.
 */
import { createHash } from 'node:crypto'

/** Файл в памяти. */
export interface FakeFile {
  id: string
  name: string
  mimeType: string
  parents: string[]
  bytes: Uint8Array
  version: number
  createdTime: string
  modifiedTime: string
  appProperties?: Record<string, string>
  trashed?: boolean
}

/** Поддельный Drive. */
export class FakeDrive {
  readonly files = new Map<string, FakeFile>()
  private nextId = 1
  /** Текущее время (мс), меняется тестом. */
  now = Date.UTC(2026, 9, 7, 12, 0, 0)
  /** Вызывается после каждого скачивания (тест может «изменить файл чужими руками»). */
  onDownload?: (file: FakeFile) => void
  /** Журнал запросов. */
  readonly log: string[] = []

  constructor() {
    this.add({ id: 'root', name: 'My Drive', mimeType: 'application/vnd.google-apps.folder', parents: [] })
  }

  /** Добавляет файл напрямую. */
  add(file: Partial<FakeFile> & { name: string; mimeType: string; parents: string[] }): FakeFile {
    const time = new Date(this.now).toISOString()
    const full: FakeFile = { id: file.id ?? `f${this.nextId++}`, bytes: new Uint8Array(), version: 1, createdTime: time, modifiedTime: time, ...file }
    this.files.set(full.id, full)
    return full
  }

  /** Файлы в папке. */
  childrenOf(parent: string) {
    return [...this.files.values()].filter((file) => file.parents.includes(parent) && !file.trashed)
  }

  /** Метаданные в формате API. */
  private meta(file: FakeFile) {
    const isFolder = file.mimeType === 'application/vnd.google-apps.folder'
    return {
      id: file.id, name: file.name, mimeType: file.mimeType, version: String(file.version),
      createdTime: file.createdTime, modifiedTime: file.modifiedTime, appProperties: file.appProperties,
      ...(isFolder ? {} : { size: String(file.bytes.length), md5Checksum: createHash('md5').update(file.bytes).digest('hex') }),
    }
  }

  /** Реализация `fetch`. */
  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    this.log.push(`${method} ${url.pathname}${url.searchParams.get('uploadType') ? `?${url.searchParams.get('uploadType')}` : ''}`)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const notFound = () => json({ error: { code: 404, message: 'File not found', errors: [{ reason: 'notFound' }] } }, 404)
    const path = url.pathname.replace(/^\/(upload\/)?drive\/v3/, '')
    const body = init.body instanceof Uint8Array ? init.body
      : init.body instanceof Blob ? new Uint8Array(await init.body.arrayBuffer())
        : typeof init.body === 'string' ? new TextEncoder().encode(init.body) : new Uint8Array()

    if (path === '/about') return json({ user: { emailAddress: 'tester@example.com' } })
    if (path === '/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? ''
      const parent = /'([^']+)' in parents/.exec(q)?.[1]
      const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, '$1')
      const mime = /mimeType = '([^']+)'/.exec(q)?.[1]
      const files = this.childrenOf(parent ?? '').filter((file) => (name === undefined || file.name === name) && (mime === undefined || file.mimeType === mime))
      files.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))
      return json({ files: files.map((file) => this.meta(file)) })
    }
    if (path === '/files' && method === 'POST' && url.searchParams.get('uploadType') === 'multipart') {
      const text = new TextDecoder('latin1').decode(body)
      const boundary = /boundary=(\S+)/.exec((init.headers as Record<string, string>)['Content-Type'] ?? '')![1]!
      const parts = text.split(`--${boundary}`)
      const metadata = JSON.parse(parts[1]!.split('\r\n\r\n')[1]!.trim()) as { name: string; parents: string[]; mimeType: string; appProperties?: Record<string, string> }
      const headerLength = new TextEncoder().encode(`--${boundary}${parts[1]}--${boundary}`).length + parts[2]!.indexOf('\r\n\r\n') + 4
      const end = body.length - new TextEncoder().encode(`\r\n--${boundary}--`).length
      const file = this.add({ ...metadata, bytes: body.slice(headerLength, end) })
      return json(this.meta(file))
    }
    if (path === '/files' && method === 'POST') {
      const metadata = JSON.parse(new TextDecoder().decode(body)) as { name: string; parents: string[]; mimeType: string }
      return json(this.meta(this.add(metadata)))
    }
    const copy = /^\/files\/([^/]+)\/copy$/.exec(path)
    if (copy && method === 'POST') {
      const source = this.files.get(copy[1]!)
      if (!source) return notFound()
      const metadata = JSON.parse(new TextDecoder().decode(body)) as { name: string; parents: string[] }
      return json(this.meta(this.add({ name: metadata.name, parents: metadata.parents, mimeType: source.mimeType, bytes: source.bytes.slice() })))
    }
    const single = /^\/files\/([^/]+)$/.exec(path)
    if (single) {
      const file = this.files.get(decodeURIComponent(single[1]!))
      if (!file) return notFound()
      if (method === 'DELETE') {
        this.files.delete(file.id)
        return new Response(null, { status: 204 })
      }
      if (method === 'PATCH') {
        file.bytes = body
        file.version++
        file.modifiedTime = new Date(this.now).toISOString()
        return json(this.meta(file))
      }
      if (url.searchParams.get('alt') === 'media') {
        const bytes = file.bytes.slice()
        this.onDownload?.(file)
        return new Response(bytes, { status: 200 })
      }
      return json(this.meta(file))
    }
    return json({ error: { code: 400, message: `unsupported ${method} ${path}` } }, 400)
  }
}
