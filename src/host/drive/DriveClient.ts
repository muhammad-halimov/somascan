/**
 * Минимальный клиент Google Drive API v3 для таблиц: поиск, метаданные, скачивание, замена содержимого,
 * копирование, удаление, папки — как `DriveClient` мобильного приложения. Общие диски поддерживаются
 * (`supportsAllDrives`). Ошибки — `DriveError` с кодом, по которому журнал пишет понятную причину.
 */
import { isRecord } from '@/shared/settings'

/** Базовые адреса API. */
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

/** MIME-тип папки Drive. */
export const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** MIME-тип таблицы `.xlsx`. */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Почему запрос не удался. */
export type DriveErrorCode = 'authRequired' | 'notFound' | 'busy' | 'accessDenied' | 'network' | 'io'

/** Ошибка Drive с кодом. */
export class DriveError extends Error {
  readonly code: DriveErrorCode
  constructor(code: DriveErrorCode, detail: string) {
    super(detail)
    this.name = 'DriveError'
    this.code = code
  }
}

/** Поля файла, которые нужны программе. */
export interface DriveFile {
  id: string
  name: string
  mimeType: string
  /** MD5 содержимого (у папок нет). */
  md5Checksum?: string
  /** Размер в байтах (строкой, как в API). */
  size?: string
  /** Версия: растёт при каждом изменении файла. */
  version?: string
  /** Когда создан и изменён (RFC 3339). */
  createdTime?: string
  modifiedTime?: string
  /** Свои метки приложения. */
  appProperties?: Record<string, string>
}

/** Поля, запрашиваемые у каждого файла. */
const FILE_FIELDS = 'id,name,mimeType,md5Checksum,size,version,createdTime,modifiedTime,appProperties'

/** Экранирует строку для запроса `q`. */
const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** Ответ Drive со статусом ошибки → `DriveError`. */
export function driveError(status: number, body: unknown): DriveError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null
  const first = error && Array.isArray(error.errors) && isRecord(error.errors[0]) ? error.errors[0] : null
  const reason = typeof first?.reason === 'string' ? first.reason : typeof error?.status === 'string' ? error.status : undefined
  const detail = `${typeof error?.message === 'string' ? error.message : `HTTP ${status}`}${reason ? ` (${reason})` : ''}`
  if (status === 401) return new DriveError('authRequired', detail)
  if (status === 404) return new DriveError('notFound', detail)
  if (status === 429 || status >= 500 || status === 412 || reason === 'userRateLimitExceeded' || reason === 'rateLimitExceeded') return new DriveError('busy', detail)
  if (status === 403 && reason !== 'storageQuotaExceeded') return new DriveError('accessDenied', detail)
  return new DriveError('io', detail)
}

/**
 * Предел одного запроса, мс: зависший запрос не держит цикл слежения (Consum в Drive, мост с телефонами) дольше —
 * он кончается ошибкой связи, и следующая проверка пробует снова.
 */
export const REQUEST_TIMEOUT_MS = 120_000

/** Клиент Drive с токеном доступа. */
export class DriveClient {
  private readonly token: string
  private readonly fetcher: typeof fetch

  /**
   * @param token Access-токен с областью Drive.
   * @param fetcher Реализация `fetch` (подменяется в тестах).
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
      if (error instanceof DriveError && error.code === 'notFound') return null
      throw error
    }
  }

  /** Файлы в папке с именем `name` (не в корзине), сначала новые. */
  find(parentId: string, name: string, mimeType?: string): Promise<DriveFile[]> {
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
    const boundary = `somasync${Math.random().toString(36).slice(2)}`
    const metadata = JSON.stringify({ name, parents: [parentId], mimeType, ...(appProperties ? { appProperties } : {}) })
    const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`)
    const tail = Buffer.from(`\r\n--${boundary}--`)
    return this.json<DriveFile>(`${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: Buffer.concat([head, bytes, tail]),
    })
  }

  /** Заменяет содержимое файла (новая ревизия — атомарно). */
  update(id: string, bytes: Uint8Array, mimeType: string): Promise<DriveFile> {
    return this.json<DriveFile>(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&supportsAllDrives=true&fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': mimeType },
      body: Buffer.from(bytes),
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
      if (error instanceof DriveError && error.code === 'notFound') return
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

  /** Запрос с токеном; ошибки сети и статусы → `DriveError`. */
  private async send(url: string, init: RequestInit = {}): Promise<Response> {
    let response: Response
    try {
      response = await this.fetcher(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${this.token}` },
        signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      throw new DriveError('network', error instanceof Error ? error.message : String(error))
    }
    if (response.ok) return response
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // тело ошибки не JSON
    }
    throw driveError(response.status, body)
  }
}
