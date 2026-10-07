import { providerRegistry } from '@/features/recognition/providers/ProviderRegistry'
import type { SyncAccess } from '@/features/recognition/catalog/ModelCatalog'
import type { ProviderId } from '@/features/recognition/types'
import type { GeneralSettings } from './settingsSchema'

/** Учётные данные провайдера из настроек (без пробелов по краям, адрес по умолчанию — запасной вариант). */
export function getProviderAccess(general: GeneralSettings, id: ProviderId): SyncAccess {
  return {
    apiKey: general.apiKeys[id].trim(),
    endpoint: general.endpoints[id].trim() || providerRegistry.get(id).defaultEndpoint,
  }
}
