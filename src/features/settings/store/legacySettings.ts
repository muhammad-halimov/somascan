import type { KeyValueStore } from '@/lib/storage/KeyValueStore'
import { parseSettings, type AppSettings } from './settingsSchema'

/** Ключи, которые использовали версии приложения до того, как настройки стали храниться одним документом. */
const LEGACY_KEYS = {
  // Язык и провайдер хранились обычными строками, остальное — в JSON.
  language: 'somascan_language',
  provider: 'somascan_provider',
  models: 'somascan_models',
  apiKeys: 'somascan_keys',
  endpoints: 'somascan_endpoints',
  lmStudioEndpoint: 'somascan_lmstudio_endpoint',
} as const

/** Разбирает устаревшее JSON-значение, `undefined` — если его нет или оно повреждено. */
function readJson(storage: KeyValueStore, key: string): unknown {
  const raw = storage.get(key)
  if (raw === null) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Читает настройки, сохранённые старыми версиями приложения, или `null`, если их нет.
 * Значения проверяются так же, как и текущие настройки.
 */
export function readLegacySettings(storage: KeyValueStore, defaults: AppSettings): AppSettings | null {
  if (Object.values(LEGACY_KEYS).every((key) => storage.get(key) === null)) return null

  const lmStudioEndpoint = storage.get(LEGACY_KEYS.lmStudioEndpoint)
  const endpoints = readJson(storage, LEGACY_KEYS.endpoints)
  return parseSettings({
    general: {
      language: storage.get(LEGACY_KEYS.language),
      provider: storage.get(LEGACY_KEYS.provider),
      models: readJson(storage, LEGACY_KEYS.models),
      apiKeys: readJson(storage, LEGACY_KEYS.apiKeys),
      endpoints: lmStudioEndpoint ? { lmstudio: lmStudioEndpoint, ...(endpoints as object) } : endpoints,
    },
  }, defaults)
}

/** Удаляет устаревшие ключи после миграции. */
export function clearLegacySettings(storage: KeyValueStore) {
  for (const key of Object.values(LEGACY_KEYS)) storage.remove(key)
}
