/**
 * Нативный хост движка очереди: объект `SomascanHost`, который ставит нативная часть
 * (Android — `addJavascriptInterface` скрытого WebView, iOS — объект в JSContext).
 *
 * Синхронные методы — хранилище «ключ — значение» (файлы приложения), события, журнал, таймеры;
 * долгие операции (сетевой диск, HTTP, токен Google) — `call`: хост выполняет их у себя
 * и отвечает вызовом `__somascanSettle(id, ok, json)`.
 */

/** Методы, которые даёт нативная часть. */
export interface NativeHost {
  /** Значение по ключу или `null`/`undefined`, если его нет. */
  storageGet(key: string): string | null | undefined
  /** Сохраняет значение (атомарно, на диск). */
  storageSet(key: string, value: string): void
  /** Удаляет значение. */
  storageRemove(key: string): void
  /** Долгая операция `method` с аргументами (JSON); ответ — через `__somascanSettle`. */
  call(id: number, method: string, args: string): void
  /** Событие движка (`EngineEvent` без поля `type`, JSON). */
  emit(type: string, payload: string): void
  /** Строка журнала. */
  log(level: string, message: string): void
  /** Таймер (только там, где своего `setTimeout` нет): по истечении — `__somascanTimer(id)`. */
  setTimer(id: number, delay: number): void
  /** Отмена таймера. */
  clearTimer(id: number): void
}

/** Отказ долгой операции. */
export interface HostFailure {
  /** Код (у сетевого диска — коды `UploadError`). */
  code: string
  /** Сообщение. */
  message: string
}

/** Глобальный объект с полями хоста. */
const scope = globalThis as unknown as Record<string, unknown>

/** Хост из глобального объекта. Без него движок не работает — это ошибка сборки, а не данных. */
function native(): NativeHost {
  const candidate = scope.SomascanHost as NativeHost | undefined
  if (!candidate) throw new Error('SomascanHost is not installed')
  return candidate
}

/** Ждущие ответа долгие операции. */
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (failure: HostFailure) => void }>()
let nextCallId = 1

/** Ответ хоста на `call`. */
scope.__somascanSettle = (id: number, ok: boolean, payload: string | null | undefined) => {
  const waiter = pending.get(id)
  if (!waiter) return
  pending.delete(id)
  let data: unknown = null
  try {
    data = payload ? JSON.parse(payload) : null
  } catch {
    data = { code: 'io', message: `bad host payload: ${String(payload).slice(0, 200)}` }
  }
  if (ok) waiter.resolve(data)
  else waiter.reject(isFailure(data) ? data : { code: 'io', message: String(payload) })
}

/** Похоже ли значение на отказ хоста. */
const isFailure = (value: unknown): value is HostFailure =>
  typeof value === 'object' && value !== null && typeof (value as HostFailure).code === 'string'

/** Доступ к хосту. */
export const host = {
  /** Долгая операция: результат — JSON-ответ хоста, отказ — `HostFailure`. */
  call<T>(method: string, args: unknown = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = nextCallId++
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      try {
        native().call(id, method, JSON.stringify(args))
      } catch (error) {
        pending.delete(id)
        reject({ code: 'io', message: error instanceof Error ? error.message : String(error) })
      }
    })
  },
  storageGet: (key: string): string | null => native().storageGet(key) ?? null,
  storageSet: (key: string, value: string) => native().storageSet(key, value),
  storageRemove: (key: string) => native().storageRemove(key),
  emit: (type: string, payload: unknown) => native().emit(type, JSON.stringify(payload)),
  log: (level: string, message: string) => native().log(level, message),
  setTimer: (id: number, delay: number) => native().setTimer(id, delay),
  clearTimer: (id: number) => native().clearTimer(id),
}

/** Хранилище хоста в виде `Storage` — для `KeyValueStore` (очередь, настройки движка). */
export const hostStorage = {
  getItem: (key: string) => host.storageGet(key),
  setItem: (key: string, value: string) => host.storageSet(key, value),
  removeItem: (key: string) => host.storageRemove(key),
} as unknown as Storage
