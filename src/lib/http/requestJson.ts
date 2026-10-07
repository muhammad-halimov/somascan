import { Capacitor, registerPlugin } from '@capacitor/core'
import { isRecord } from '@/lib/validation/guards'
import { HttpError } from './HttpError'

/** Параметры `fetch` плюс необязательный таймаут. */
export interface JsonRequestInit extends RequestInit {
  /** Прервать запрос через столько миллисекунд. */
  timeoutMs?: number
  /**
   * Отправить запрос из нативной части (плагин `NativeHttp`), а не из WebView. Нужно для серверов
   * в локальной сети по `http://` (LM Studio): страница приложения открыта по `https://localhost`
   * (Android) или `capacitor://localhost` (iOS), и WebView блокирует такие запросы как смешанное
   * содержимое; у нативного запроса нет ни этого ограничения, ни CORS. Отмена (`signal`) закрывает
   * соединение по-настоящему — сервер видит разрыв и прекращает работу. В браузере игнорируется.
   */
  native?: boolean
}

/**
 * Извлекает сообщение об ошибке из JSON-тела ошибки.
 * Покрывает распространённые формы: `{ error: { message } }`, `{ error: "..." }`, `{ message }`.
 */
function readErrorMessage(body: unknown): string | null {
  if (!isRecord(body)) return null
  const { error, message } = body
  if (typeof error === 'string') return error
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return typeof message === 'string' ? message : null
}

/**
 * `fetch` с сигналом отмены от вызывающего и необязательным таймаутом.
 * Реализован вручную, потому что `AbortSignal.any` / `AbortSignal.timeout`
 * отсутствуют в старых iOS WebView.
 */
async function fetchWithTimeout(url: string, { timeoutMs, ...init }: JsonRequestInit) {
  if (timeoutMs === undefined) return fetch(url, init)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forwardAbort = () => controller.abort()
  // Вызывающий мог уже отменить запрос; события `abort` повторно не воспроизводятся.
  if (init.signal?.aborted) forwardAbort()
  init.signal?.addEventListener('abort', forwardAbort, { once: true })
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener('abort', forwardAbort)
  }
}

/** Ошибка отмены, как у `fetch`. */
const abortError = () => new DOMException('The operation was aborted.', 'AbortError')

/** Локальный плагин `NativeHttp` (`android/.../NativeHttpPlugin.java`, `ios/App/App/NativeHttpPlugin.swift`). */
interface NativeHttpPlugin {
  request(options: { id: string; url: string; method: string; headers: Record<string, string>; body?: string; timeoutMs?: number }): Promise<{ status: number; body: string }>
  cancel(options: { id: string }): Promise<void>
}

const NativeHttp = registerPlugin<NativeHttpPlugin>('NativeHttp')

/** Номер нативного запроса (для отмены). */
let nativeRequestCounter = 0

/**
 * Запрос через нативный плагин `NativeHttp`. Отмена и таймаут закрывают соединение на стороне
 * устройства (`cancel`), так что сервер узнаёт о разрыве и останавливает генерацию.
 */
async function nativeRequest(url: string, { timeoutMs, signal, method, headers, body }: JsonRequestInit): Promise<{ status: number; data: unknown }> {
  if (signal?.aborted) throw abortError()
  const id = `req-${Date.now()}-${++nativeRequestCounter}`
  const cancel = () => void NativeHttp.cancel({ id }).catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  let stop = () => undefined as void
  const aborted = new Promise<never>((_, reject) => {
    stop = () => {
      cancel()
      reject(abortError())
    }
    signal?.addEventListener('abort', stop, { once: true })
    if (timeoutMs !== undefined) timer = setTimeout(stop, timeoutMs)
  })
  try {
    const response = await Promise.race([
      NativeHttp.request({
        id,
        url,
        method: method ?? 'GET',
        headers: Object.fromEntries(new Headers(headers).entries()),
        body: typeof body === 'string' ? body : undefined,
      }),
      aborted,
    ])
    return { status: response.status, data: response.body }
  } catch (error) {
    // Отмена изнутри плагина (если `cancel` пришёл раньше ответа) — тоже AbortError.
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'cancelled') throw abortError()
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
  }
}

/** Тело нативного ответа (строка) как JSON; не JSON — `undefined`. */
function parseNativeBody(data: unknown): unknown {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}

/**
 * Выполняет запрос и разбирает JSON-ответ.
 *
 * @throws {HttpError} при статусе не 2xx или теле, которое не является JSON.
 * @throws {DOMException} `AbortError` при отмене или истечении таймаута.
 * @throws {TypeError} при сбое сети (офлайн, DNS, CORS).
 */
export async function requestJson<T>(url: string, init: JsonRequestInit = {}): Promise<T> {
  if (init.native && Capacitor.isNativePlatform()) {
    const { status, data } = await nativeRequest(url, init)
    const body = parseNativeBody(data)
    const ok = status >= 200 && status < 300
    if (!ok) throw new HttpError(status, readErrorMessage(body))
    if (body === undefined) throw new HttpError(status, null)
    return body as T
  }

  const { native: _native, ...fetchInit } = init
  const response = await fetchWithTimeout(url, fetchInit)

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Успешный ответ должен быть JSON; ответ с ошибкой может быть HTML или пустым.
    if (response.ok) throw new HttpError(response.status, null)
  }

  if (!response.ok) throw new HttpError(response.status, readErrorMessage(body))
  return body as T
}
