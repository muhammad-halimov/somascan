/**
 * Окно: заголовок (только macOS — место под кнопки окна и переключатель темы), вкладки, содержимое вкладки.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DatabaseIcon, HomeIcon, LinkIcon, MoonIcon, SunIcon, WrenchIcon } from '@/components/icons/Icons'
import { Tabs } from '@/components/ui/Tabs'
import { LinksScreen } from '@/features/links/LinksScreen'
import { RunScreen } from '@/features/run/RunScreen'
import { SettingsScreen } from '@/features/settings/SettingsScreen'
import { StorageScreen } from '@/features/storage/StorageScreen'
import type { TabId } from '@/shared/protocol'
import type { ThemePreference } from '@/shared/settings'
import { api, appInfoStore, settingsStore, useSettings, useStore } from './state'
import './App.css'

/** Вкладки по порядку. */
const TABS: readonly TabId[] = ['home', 'storage', 'links', 'advanced']
/** Значки вкладок. */
const ICONS: Record<TabId, ReactNode> = { home: <HomeIcon />, storage: <DatabaseIcon />, links: <LinkIcon />, advanced: <WrenchIcon /> }
/** Ключ темы в localStorage: `index.html` читает его до загрузки скриптов, чтобы окно не мигало. */
const THEME_KEY = 'somaco.theme'

/** Тёмная ли тема сейчас (с учётом системной); ставит `<html data-theme>`. */
function useDarkTheme(theme: ThemePreference): boolean {
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(m.matches)
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }, [])
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try {
      localStorage.setItem(THEME_KEY, JSON.stringify(theme))
    } catch {
      // без хранилища тоже работает: тема применится после загрузки
    }
  }, [dark, theme])
  return dark
}

/** Окно программы. */
export function App() {
  const { t } = useTranslation()
  const settings = useSettings()
  const [tab, setTab] = useState<TabId>('home')
  const dark = useDarkTheme(settings.theme)
  // заголовок нужен только на macOS (место под кнопки окна); в Windows у окна своя рамка, тема — в «Расширенных»
  const mac = useStore(appInfoStore).platform === 'darwin'
  useEffect(() => api.onNavigate(setTab), [])

  return (
    <div className="shell">
      {mac && (
        <header className="titlebar">
          <button type="button" className="titlebar-btn" aria-label={dark ? t('theme.toLight') : t('theme.toDark')} onClick={() => settingsStore.update({ theme: dark ? 'light' : 'dark' })}>
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
        </header>
      )}
      <Tabs role="tablist" label={t('sections')} panelIdPrefix="panel" value={tab} options={TABS.map((id) => ({ value: id, label: t(`tabs.${id}`), icon: ICONS[id] }))} onChange={setTab} />
      <main key={tab} className="content anim-enter" role="tabpanel" id={`panel-${tab}`} aria-label={t(`tabs.${tab}`)}>
        <div className={`content-inner${tab === 'home' ? ' is-fill' : ''}`}>
          {tab === 'home' && <RunScreen />}
          {tab === 'storage' && <StorageScreen />}
          {tab === 'links' && <LinksScreen />}
          {tab === 'advanced' && <SettingsScreen goHome={() => setTab('home')} />}
        </div>
      </main>
    </div>
  )
}
