import { ScanWorkspace } from '@/features/workspace/ScanWorkspace'
import { SettingsSheet } from '@/features/settings/SettingsSheet'
import { useSettings } from '@/features/settings/store/useSettings'
import { UploadsPopover } from '@/features/uploads/components/UploadsPopover'
import { useAndroidBackButton } from '@/hooks/useAndroidBackButton'
import { useOffline } from '@/hooks/useOffline'
import { usePanel } from '@/hooks/usePanel'
import { usePresence } from '@/hooks/usePresence'
import { useTheme } from '@/hooks/useTheme'
import { useVisualViewportHeight } from '@/hooks/useVisualViewportHeight'
import { useLanguageSync } from '@/i18n/useLanguageSync'
import { AppHeader } from './components/AppHeader'
import { OfflineBanner } from './components/OfflineBanner'
import { useModelCatalogSync } from './hooks/useModelCatalogSync'
import './App.css'

/** Панели, которые открываются из шапки. */
export type AppPanel = 'settings' | 'uploads'

/**
 * Корневой компонент: один экран (рабочая область сканирования), две панели поверх него
 * (настройки и загрузки) и общая связка с платформой.
 */
export function App() {
  const settings = useSettings()
  const isOffline = useOffline()
  const panels = usePanel<AppPanel>()
  const offlineBanner = usePresence(isOffline)

  // Связка с платформой и глобальным состоянием.
  useTheme(settings.general.theme)
  useVisualViewportHeight()
  useAndroidBackButton()
  useLanguageSync(settings.general.language)
  useModelCatalogSync(settings.general)

  return (
    <main className="app-shell">
      <AppHeader openPanel={panels.panel} onTogglePanel={panels.toggle} />
      {offlineBanner.mounted && <OfflineBanner isClosing={offlineBanner.closing} />}
      <ScanWorkspace />
      {panels.panel === 'settings' && <SettingsSheet isClosing={panels.isClosing} onClose={panels.close} />}
      {panels.panel === 'uploads' && <UploadsPopover isClosing={panels.isClosing} onClose={panels.close} />}
    </main>
  )
}
