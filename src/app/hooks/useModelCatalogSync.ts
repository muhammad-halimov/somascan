import { useEffect } from 'react'
import { modelCatalog } from '@/features/recognition/catalog/ModelCatalog'
import { PROVIDER_IDS } from '@/features/recognition/types'
import { getProviderAccess } from '@/features/settings/store/providerAccess'
import { settingsStore } from '@/features/settings/store/SettingsStore'
import type { GeneralSettings } from '@/features/settings/store/settingsSchema'
import { useStore } from '@/lib/store/useStore'

/** Ждём, пока пользователь закончит вводить ключ или URL, прежде чем обращаться к серверам. */
const DEBOUNCE_MS = 700

/**
 * Поддерживает списки моделей всех провайдеров загруженными и актуальными, чтобы каждая
 * вкладка настроек сразу показывала свои модели. Запускается при старте, при смене
 * учётных данных и при очистке кэша; провайдеров с ещё свежим списком каталог пропускает.
 *
 * @param general Текущие настройки «General» (учётные данные каждого провайдера).
 */
export function useModelCatalogSync(general: GeneralSettings) {
  const { entries } = useStore(modelCatalog)
  /** Меняется только при смене учётных данных какого-либо провайдера. */
  const credentialsKey = JSON.stringify(PROVIDER_IDS.map((id) => getProviderAccess(general, id)))

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void modelCatalog.syncAll((id) => getProviderAccess(settingsStore.getSnapshot().general, id))
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [credentialsKey, entries])
}
