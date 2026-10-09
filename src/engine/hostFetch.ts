/**
 * `fetch` для движка очереди: запрос выполняет хост (`http` → Android HttpURLConnection,
 * iOS URLSession), тело запроса и ответа — base64. Поддерживается то, что нужно `DriveClient`:
 * метод, заголовки, тело строкой или байтами, ответ `ok` / `status` / `json()` / `arrayBuffer()`.
 */
import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from '@/lib/encoding/base64'
import { host } from './host'

/** Ответ хоста. */
interface HostResponse {
  /** HTTP-статус. */
  status: number
  /** Тело (base64). */
  body: string
}

/** Минимальный ответ в духе `Response`. */
class EngineResponse {
  readonly status: number
  readonly ok: boolean
  private readonly bytes: Uint8Array

  constructor(status: number, bytes: Uint8Array) {
    this.status = status
    this.ok = status >= 200 && status < 300
    this.bytes = bytes
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength) as ArrayBuffer
  }

  async text(): Promise<string> {
    return bytesToUtf8(this.bytes)
  }

  async json(): Promise<unknown> {
    return JSON.parse(bytesToUtf8(this.bytes))
  }
}

/** Тело запроса в байтах. */
function bodyBytes(body: unknown): Uint8Array | undefined {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string') return utf8ToBytes(body)
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  throw new TypeError('unsupported request body')
}

/** `fetch` через хост. Сетевой сбой — `TypeError`, как у настоящего `fetch`. */
export const hostFetch = (async (input: string | URL, init: RequestInit = {}) => {
  const bytes = bodyBytes(init.body)
  let response: HostResponse
  try {
    response = await host.call<HostResponse>('http', {
      method: init.method ?? 'GET',
      url: String(input),
      headers: { ...(init.headers as Record<string, string> | undefined) },
      ...(bytes ? { body: bytesToBase64(bytes) } : {}),
    })
  } catch (error) {
    const message = typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : String(error)
    throw new TypeError(message)
  }
  return new EngineResponse(response.status, response.body ? base64ToBytes(response.body) : new Uint8Array())
}) as unknown as typeof fetch
