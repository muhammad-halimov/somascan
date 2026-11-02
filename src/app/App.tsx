import { useRef, useState } from 'react'
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
import { discardFrozenGlass, prepareFrozenGlass, takeFrozenGlass, type FrozenGlass } from '@/lib/glass/frozenGlass'
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
  /** Стекло открытого окна — размытый снимок экрана под ним (null — живое размытие). */
  const [glass, setGlass] = useState<FrozenGlass | null>(null)
  /** Экран снимается перед открытием окна: повторное нажатие в это время окно не переключает. */
  const freezing = useRef(false)

  /**
   * Открывает или закрывает окно. Перед открытием снимает экран под ним (пока ни одно окно не открыто — иначе оно
   * попало бы в снимок): стекло окна — этот снимок, размытый один раз (`takeFrozenGlass`). Снимок начинается ещё
   * при касании кнопки (`prepareFrozenGlass`).
   */
  const togglePanel = async (next: AppPanel) => {
    if (freezing.current) return
    if (panels.panel !== null) {
      discardFrozenGlass()
      // Другое окно поверх открытого — на живом размытии; закрывающееся окно остаётся со своим стеклом.
      if (panels.panel !== next) setGlass(null)
      panels.toggle(next)
      return
    }
    freezing.current = true
    const frozen = await takeFrozenGlass()
    freezing.current = false
    setGlass(frozen)
    panels.toggle(next)
  }

  // Связка с платформой и глобальным состоянием.
  useTheme(settings.general.theme)
  useVisualViewportHeight()
  useAndroidBackButton()
  useLanguageSync(settings.general.language)
  useModelCatalogSync(settings.general)

  return (
    <main className="app-shell">
      <AppHeader
        openPanel={panels.panel}
        onTogglePanel={(next) => void togglePanel(next)}
        onPreparePanel={() => panels.panel === null && prepareFrozenGlass()}
      />
      {offlineBanner.mounted && <OfflineBanner isClosing={offlineBanner.closing} />}
      <ScanWorkspace />
      {panels.panel === 'settings' && <SettingsSheet isClosing={panels.isClosing} onClose={panels.close} glass={glass} />}
      {panels.panel === 'uploads' && <UploadsPopover isClosing={panels.isClosing} onClose={panels.close} glass={glass} />}
    </main>
  )
}
