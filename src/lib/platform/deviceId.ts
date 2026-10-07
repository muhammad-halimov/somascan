/**
 * Постоянный идентификатор этого устройства (платформа + случайный суффикс), создаётся при первом
 * обращении и хранится на устройстве. Им подписывается блокировка таблицы на сетевом диске,
 * чтобы было видно, какое устройство её держит.
 */
import { Capacitor } from '@capacitor/core'
import { appStorage, type KeyValueStore } from '@/lib/storage/KeyValueStore'

/** Ключ хранилища. */
const KEY = 'somascan.device.v1'

/** Короткий случайный суффикс. */
const randomSuffix = () => globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10)

/** Идентификатор устройства, например `android-3f1c9a2b`. */
export function getDeviceId(storage: KeyValueStore = appStorage): string {
  const existing = storage.get(KEY)
  if (existing) return existing
  const id = `${Capacitor.getPlatform()}-${randomSuffix()}`
  storage.set(KEY, id)
  return id
}
