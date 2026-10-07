import { useStore } from '@/lib/store/useStore'
import { settingsStore } from './SettingsStore'

/**
 * Текущие настройки; компонент перерисовывается при их изменении.
 * Менять настройки нужно через методы `settingsStore`.
 */
export function useSettings() {
  return useStore(settingsStore)
}
