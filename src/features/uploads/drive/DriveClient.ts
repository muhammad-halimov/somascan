/**
 * Минимальный клиент Google Drive API v3 для таблицы: поиск, скачивание, загрузка, копирование,
 * удаление файлов и папок. Запросы идут из WebView (`fetch`): API Google разрешает CORS.
 * Общие диски поддерживаются (`supportsAllDrives`).
 */
import { isRecord } from '@/lib/validation/guards'
import { UploadError } from '../UploadError'

/** Базовые адреса API. */
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

/** MIME-тип папки Drive. */
export const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** MIME-тип таблицы `.xlsx`. */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Поля файла, которые нужны записи. */
export interface DriveFile {
  /** Id файла. */
  id: string
  /** Имя. */
  name: string
  /** MIME-тип. */
  mimeType: string
  /** MD5 содержимого (у папок и файлов Google Docs нет). */
  md5Checksum?: string
  /** Размер в байтах (строкой, как в API). */
  size?: string
  /** Версия: растёт при каждом изменении файла. */
  version?: string
  /** Когда создан (RFC 3339). */
  createdTime?: string
  /** Когда изменён (RFC 3339). */
  modifiedTime?: string
  /** Свои метки приложения. */
  appProperties?: Record<string, string>
}

/** Поля, запрашиваемые у каждого файла. */
const FILE_FIELDS = 'id,name,mimeType,md5Checksum,size,version,createdTime,modifiedTime,appProperties'

/** Экранирует строку для запроса `q`. */
const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** Причина ошибки из тела ответа Drive (`error.errors[0].reason`). */
function reasonOf(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.error)) return undefined
  const errors = body.error.errors
  if (Array.isArray(errors) && isRecord(errors[0]) && typeof errors[0].reason === 'string') return errors[0].reason
  return typeof body.error.status === 'string' ? body.error.status : undefined
}

/** Сообщение об ошибке из тела ответа. */
function messageOf(body: unknown, status: number): string {
  return isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string' ? body.error.message : `HTTP ${status}`
}

/** Ответ Drive со статусом ошибки → `UploadError`. */
export function driveError(status: number, body: unknown): UploadError {
  const reason = reasonOf(body)
  const detail = `${messageOf(body, status)}${reason ? ` (${reason})` : ''}`
  if (status === 401) return new UploadError('authRequired', { detail })
  if (status === 404) return new UploadError('notFound', { detail })
  if (status === 429 || status >= 500 || reason === 'userRateLimitExceeded' || reason === 'rateLimitExceeded') return new UploadError('busy', { detail })
  if (status === 403 && reason === 'storageQuotaExceeded') return new UploadError('io', { detail })
  if (status === 403) return new UploadError('accessDenied', { detail })
  if (status === 412) return new UploadError('busy', { detail })
  return new UploadError('io', { detail })
}

/** Клиент Drive с токеном доступа. */
export class DriveClient {
  /** Токен доступа. */
  private readonly token: string
  /** Реализация `fetch` (подменяется в тестах). */
  private readonly fetcher: typeof fetch

  /**
   * @param token Access-токен с областью Drive.
   * @param fetcher Реализация `fetch`.
   */
  constructor(token: string, fetcher: typeof fetch = (...args) => fetch(...args)) {
    this.token = token
    this.fetcher = fetcher
  }

  /** Метаданные файла или папки; `null`, если нет. */
  async get(id: string): Promise<DriveFile | null> {
    try {
      return await this.json<DriveFile>(`${API}/files/${encodeURIComponent(id)}?fields=${FILE_FIELDS}&supportsAllDrives=true`)
    } catch (error) {
      if (error instanceof UploadError && error.code === 'notFound') return null
      throw error
    }
  }

  /** Файлы в папке с именем `name` (не в корзине), сначала новые. */
  async find(parentId: string, name: string, mimeType?: string): Promise<DriveFile[]> {
    const q = [`${quote(parentId)} in parents`, `name = ${quote(name)}`, 'trashed = false', mimeType ? `mimeType = ${quote(mimeType)}` : '']
      .filter(Boolean).join(' and ')
    return this.list(q, 'modifiedTime desc')
  }

  /** Содержимое папки (не в корзине). */
  children(parentId: string): Promise<DriveFile[]> {
    return this.list(`${quote(parentId)} in parents and trashed = false`, 'name')
  }

  /** Скачивает содержимое файла. */
  async download(id: string): Promise<Uint8Array> {
    const response = await this.send(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`)
    return new Uint8Array(await response.arrayBuffer())
  }

  /** Создаёт файл с содержимым в папке. */
  create(parentId: string, name: string, bytes: Uint8Array, mimeType: string, appProperties?: Record<string, string>): Promise<DriveFile> {
    const boundary = `somascan${Math.random().toString(36).slice(2)}`
    const metadata = JSON.stringify({ name, parents: [parentId], mimeType, ...(appProperties ? { appProperties } : {}) })
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`)
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`)
    const body = new Uint8Array(head.length + bytes.length + tail.length)
    body.set(head)
    body.set(bytes, head.length)
    body.set(tail, head.length + bytes.length)
    return this.json<DriveFile>(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: new Blob([body as Uint8Array<ArrayBuffer>]),
    })
  }

  /** Заменяет содержимое файла (новая ревизия — атомарно). */
  update(id: string, bytes: Uint8Array, mimeType: string): Promise<DriveFile> {
    return this.json<DriveFile>(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&supportsAllDrives=true&fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': mimeType },
      body: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType }),
    })
  }

  /** Копирует файл на сервере в папку под новым именем. */
  copy(id: string, parentId: string, name: string): Promise<DriveFile> {
    return this.json<DriveFile>(`${API}/files/${encodeURIComponent(id)}/copy?supportsAllDrives=true&fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [parentId] }),
    })
  }

  /** Создаёт папку. */
  createFolder(parentId: string, name: string): Promise<DriveFile> {
    return this.json<DriveFile>(`${API}/files?supportsAllDrives=true&fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: [parentId], mimeType: FOLDER_MIME }),
    })
  }

  /** Удаляет файл насовсем (не в корзину); уже удалённый — не ошибка. */
  async remove(id: string): Promise<void> {
    try {
      await this.send(`${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, { method: 'DELETE' })
    } catch (error) {
      if (error instanceof UploadError && error.code === 'notFound') return
      throw error
    }
  }

  /** Почта вошедшего пользователя. */
  async userEmail(): Promise<string> {
    const about = await this.json<{ user?: { emailAddress?: string } }>(`${API}/about?fields=user(emailAddress)`)
    return about.user?.emailAddress ?? ''
  }

  /** Все страницы `files.list` по запросу. */
  private async list(q: string, orderBy: string): Promise<DriveFile[]> {
    const files: DriveFile[] = []
    let pageToken: string | undefined
    do {
      const query = new URLSearchParams({
        q,
        orderBy,
        fields: `nextPageToken,files(${FILE_FIELDS})`,
        pageSize: '1000',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        corpora: 'allDrives',
        ...(pageToken ? { pageToken } : {}),
      })
      const page = await this.json<{ files?: DriveFile[]; nextPageToken?: string }>(`${API}/files?${query}`)
      files.push(...(page.files ?? []))
      pageToken = page.nextPageToken
    } while (pageToken)
    return files
  }

  /** Запрос с JSON-ответом. */
  private async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    return (await (await this.send(url, init)).json()) as T
  }

  /** Запрос с токеном; ошибки сети и статусы → `UploadError`. */
  private async send(url: string, init: RequestInit = {}): Promise<Response> {
    let response: Response
    try {
      response = await this.fetcher(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${this.token}` } })
    } catch (error) {
      throw new UploadError('hostUnreachable', { host: 'googleapis.com', detail: error instanceof Error ? error.message : String(error) })
    }
    if (response.ok) return response
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // Тело ошибки не JSON.
    }
    throw driveError(response.status, body)
  }
}
