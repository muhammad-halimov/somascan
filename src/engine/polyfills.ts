/**
 * Веб-API, которых нет в «голом» JS-движке, где на iOS работает очередь выгрузки (JavaScriptCore
 * вне WebView): таймеры, `AbortController` (отмена записи), кодирование UTF-8 и base64.
 * В WebView (Android) они есть — там ставятся только недостающие. `console` пишет в журнал хоста
 * всегда (Logcat / журнал iOS): встроенный у движков без отладчика никуда не выводит.
 *
 * Модуль подключается первым в `main.ts`: ExcelJS и его зависимости запоминают `setTimeout`
 * при загрузке.
 */
import { host } from './host'

/** Глобальный объект с полями, которые ставятся здесь. */
const scope = globalThis as unknown as Record<string, unknown>

/**
 * Таймеры через хост (`setTimer` / `clearTimer`; по истечении хост вызывает `__somascanTimer(id)`).
 * В WebView нулевые задержки идут через MessageChannel: таймеры скрытой страницы Chromium
 * замедляет до раза в секунду, а ExcelJS (через `process.nextTick` browserify) делает
 * тысячи нулевых `setTimeout` за одну запись.
 */
function installTimers() {
  if (typeof scope.setTimeout !== 'function') {
    let nextId = 1
    const callbacks = new Map<number, () => void>()
    scope.setTimeout = (handler: (...args: unknown[]) => void, delay = 0, ...args: unknown[]) => {
      const id = nextId++
      callbacks.set(id, () => handler(...args))
      host.setTimer(id, Math.max(0, Number(delay) || 0))
      return id
    }
    scope.clearTimeout = (id: number) => {
      if (callbacks.delete(id)) host.clearTimer(id)
    }
    scope.__somascanTimer = (id: number) => {
      const callback = callbacks.get(id)
      if (!callback) return
      callbacks.delete(id)
      callback()
    }
    return
  }
  if (typeof MessageChannel !== 'function') return
  const native = setTimeout
  const channel = new MessageChannel()
  const queue: Array<() => void> = []
  channel.port1.onmessage = () => queue.shift()?.()
  const cancelled = new Set<number>()
  let nextId = -1
  scope.setTimeout = ((handler: (...args: unknown[]) => void, delay = 0, ...args: unknown[]) => {
    if (Number(delay) > 0) return native(handler, delay, ...args)
    // Отрицательные id не пересекаются с id настоящих таймеров.
    const id = nextId--
    queue.push(() => {
      if (!cancelled.delete(id)) handler(...args)
    })
    channel.port2.postMessage(null)
    return id
  }) as typeof setTimeout
  const nativeClear = clearTimeout
  scope.clearTimeout = ((id: number) => {
    if (id < 0) cancelled.add(id)
    else nativeClear(id)
  }) as typeof clearTimeout
}

/** UTF-8 без `TextEncoder` / `TextDecoder`. */
function installTextCoding() {
  if (typeof scope.TextEncoder !== 'function') {
    scope.TextEncoder = class {
      readonly encoding = 'utf-8'
      encode(text = ''): Uint8Array {
        const bytes: number[] = []
        for (const char of text) {
          let code = char.codePointAt(0)!
          if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd
          if (code < 0x80) bytes.push(code)
          else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63))
          else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
          else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
        }
        return new Uint8Array(bytes)
      }
    }
  }
  if (typeof scope.TextDecoder !== 'function') {
    scope.TextDecoder = class {
      readonly encoding = 'utf-8'
      decode(input?: ArrayBuffer | ArrayBufferView): string {
        if (!input) return ''
        const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        let text = ''
        const codes: number[] = []
        const flush = () => {
          text += String.fromCodePoint(...codes)
          codes.length = 0
        }
        for (let index = 0; index < bytes.length;) {
          const byte = bytes[index]!
          let code = 0xfffd
          let size = 1
          if (byte < 0x80) code = byte
          else if (byte >= 0xc2 && byte < 0xe0 && index + 1 < bytes.length) {
            code = ((byte & 31) << 6) | (bytes[index + 1]! & 63)
            size = 2
          } else if (byte >= 0xe0 && byte < 0xf0 && index + 2 < bytes.length) {
            code = ((byte & 15) << 12) | ((bytes[index + 1]! & 63) << 6) | (bytes[index + 2]! & 63)
            size = 3
          } else if (byte >= 0xf0 && byte < 0xf5 && index + 3 < bytes.length) {
            code = ((byte & 7) << 18) | ((bytes[index + 1]! & 63) << 12) | ((bytes[index + 2]! & 63) << 6) | (bytes[index + 3]! & 63)
            size = 4
          }
          codes.push(code > 0x10ffff ? 0xfffd : code)
          if (codes.length >= 0x4000) flush()
          index += size
        }
        flush()
        return text
      }
    }
  }
}

/** Алфавит base64. */
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** `atob` / `btoa` для «бинарных» строк (символы 0–255). */
function installBase64() {
  if (typeof scope.btoa !== 'function') {
    scope.btoa = (binary: string) => {
      let out = ''
      for (let index = 0; index < binary.length; index += 3) {
        const a = binary.charCodeAt(index)
        const b = binary.charCodeAt(index + 1)
        const c = binary.charCodeAt(index + 2)
        const triple = (a << 16) | ((b || 0) << 8) | (c || 0)
        out += BASE64[(triple >> 18) & 63]! + BASE64[(triple >> 12) & 63]!
        out += Number.isNaN(b) ? '=' : BASE64[(triple >> 6) & 63]!
        out += Number.isNaN(c) ? '=' : BASE64[triple & 63]!
      }
      return out
    }
  }
  if (typeof scope.atob !== 'function') {
    const lookup = new Map([...BASE64].map((char, index) => [char, index]))
    scope.atob = (text: string) => {
      const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
      const parts: string[] = []
      let chunk = ''
      for (let index = 0; index < clean.length; index += 4) {
        const n = (lookup.get(clean[index]!)! << 18) | ((lookup.get(clean[index + 1]!) ?? 0) << 12)
          | ((lookup.get(clean[index + 2]!) ?? 0) << 6) | (lookup.get(clean[index + 3]!) ?? 0)
        chunk += String.fromCharCode((n >> 16) & 255)
        if (index + 2 < clean.length) chunk += String.fromCharCode((n >> 8) & 255)
        if (index + 3 < clean.length) chunk += String.fromCharCode(n & 255)
        if (chunk.length > 0x8000) {
          parts.push(chunk)
          chunk = ''
        }
      }
      parts.push(chunk)
      return parts.join('')
    }
  }
}

/** Минимальные `AbortController` / `AbortSignal`: отмена записи из «Загрузок» (`UploadWorker`). */
function installAbort() {
  if (typeof scope.AbortController === 'function') return
  class Signal {
    aborted = false
    reason: unknown = undefined
    onabort: (() => void) | null = null
    private readonly listeners = new Set<() => void>()
    addEventListener(type: string, listener: () => void) {
      if (type === 'abort') this.listeners.add(listener)
    }
    removeEventListener(type: string, listener: () => void) {
      if (type === 'abort') this.listeners.delete(listener)
    }
    throwIfAborted() {
      if (this.aborted) throw this.reason
    }
    /** Вызывает контроллер. */
    fire(reason: unknown) {
      if (this.aborted) return
      this.aborted = true
      this.reason = reason
      this.onabort?.()
      for (const listener of this.listeners) listener()
    }
  }
  scope.AbortController = class {
    readonly signal = new Signal()
    abort(reason: unknown = new Error('aborted')) {
      this.signal.fire(reason)
    }
  }
}

/** `console` → журнал хоста. */
function installConsole() {
  const write = (level: string) => (...args: unknown[]) => host.log(level, args.map((arg) => (typeof arg === 'string' ? arg : safeJson(arg))).join(' '))
  scope.console = { log: write('info'), info: write('info'), debug: write('debug'), warn: write('warn'), error: write('error') }
}

/** JSON значения для журнала (ошибки — сообщением и стеком). */
function safeJson(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

installTimers()
if (typeof scope.queueMicrotask !== 'function') scope.queueMicrotask = (callback: () => void) => void Promise.resolve().then(callback)
installTextCoding()
installBase64()
installAbort()
installConsole()
