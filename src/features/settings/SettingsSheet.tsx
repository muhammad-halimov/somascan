import { memo, useEffect, useState } from 'react'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { CloseIcon, DatabaseIcon, MoonIcon, ResetIcon, SlidersIcon, SunIcon, WrenchIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { PanelHeader } from '@/components/ui/PanelHeader'
import { Tabs } from '@/components/ui/Tabs'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useResolvedTheme } from '@/hooks/useTheme'
import { modelCatalog } from '@/features/recognition/catalog/ModelCatalog'
import { settingsStore } from './store/SettingsStore'
import { useSettings } from './store/useSettings'
import { AdvancedTab } from './tabs/AdvancedTab'
import { GeneralTab } from './tabs/GeneralTab'
import { StorageTab } from './tabs/StorageTab'
import './SettingsSheet.css'

/** Вкладки настроек в порядке показа. */
const TABS = ['general', 'storage', 'advanced'] as const

/** Id вкладки настроек. */
type SettingsTab = (typeof TABS)[number]

/** Значки вкладок настроек. */
const TAB_ICONS: Record<SettingsTab, ReactNode> = {
  general: <SlidersIcon />,
  storage: <DatabaseIcon />,
  advanced: <WrenchIcon />,
}

/** Префикс id панелей вкладок (`settings-panel-<вкладка>`), общий для ряда вкладок и панели. */
const PANEL_ID = 'settings-panel'

/** Свойства `SettingsSheet`. */
export interface SettingsSheetProps {
  /** Проигрывает анимацию закрытия. */
  isClosing: boolean
  /** Просьба закрыть: нажатие вне окна, крестик, системное «Назад». */
  onClose: () => void
}

/**
 * Окно настроек с вкладками «Основные», «Хранилище», «Дополнительно».
 * Изменения сохраняются сразу, кнопки «Сохранить» нет.
 * Закрывается только нажатием вне окна или крестиком: свайпы внутри окна
 * прокручивают содержимое и окно не закрывают.
 */
export function SettingsSheet({ isClosing, onClose }: SettingsSheetProps) {
  const { t } = useTranslation(['settings', 'common'])
  const { general } = useSettings()
  const theme = useResolvedTheme(general.theme)
  const [tab, setTab] = useState<SettingsTab>('general')
  /**
   * Вкладка, которая показана в панели. Меняется через два кадра после выбора: сначала на экран
   * попадает переключатель и плашка начинает ехать (её анимацию ведёт композитор), и только потом
   * основной поток занят монтированием новой вкладки — переезд не дёргается и не «прыгает» в начале.
   */
  const [panelTab, setPanelTab] = useState<SettingsTab>(tab)
  useEffect(() => {
    if (panelTab === tab) return
    let second = 0
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => setPanelTab(tab))
    })
    return () => {
      window.cancelAnimationFrame(first)
      window.cancelAnimationFrame(second)
    }
  }, [tab, panelTab])
  useBodyScrollLock(true)

  /** Переключает вкладку; новая панель монтируется заново и начинается сверху. */
  const selectTab = (next: SettingsTab) => setTab(next)

  /** После подтверждения возвращает настройки по умолчанию и сбрасывает кэш моделей. */
  const resetSettings = async () => {
    const confirmed = await NativeDialogs.confirm({
      title: t('resetDialog.title'),
      message: t('resetDialog.message'),
      okButtonTitle: t('resetDialog.confirm'),
      cancelButtonTitle: t('common:cancel'),
    })
    if (!confirmed) return
    settingsStore.reset()
    modelCatalog.clear()
  }

  return (
    // Закрываем только при нажатии именно на подложку, а не на что-то внутри окна.
    <div className={`settings-backdrop${isClosing ? ' is-closing' : ''}`} onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className={`settings-modal${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <PanelHeader
          titleId="settings-title"
          title={t('title')}
          level={1}
          actions={(
            <>
              <ActionButton
                variant="ghost"
                icon={theme === 'dark' ? <SunIcon /> : <MoonIcon />}
                caption={t('theme.caption')}
                label={theme === 'dark' ? t('theme.toLight') : t('theme.toDark')}
                onClick={() => settingsStore.setTheme(theme === 'dark' ? 'light' : 'dark')}
              />
              <ActionButton variant="ghost" icon={<ResetIcon />} caption={t('common:reset')} label={t('resetDialog.title')} onClick={() => void resetSettings()} />
              <ActionButton variant="ghost" icon={<CloseIcon />} caption={t('common:close')} label={t('close')} onClick={onClose} />
            </>
          )}
        />
        <Tabs
          role="tablist"
          label={t('tabs.label')}
          panelIdPrefix={PANEL_ID}
          value={tab}
          options={TABS.map((id) => ({ value: id, label: t(`tabs.${id}`), icon: TAB_ICONS[id] }))}
          onChange={selectTab}
        />
        <SettingsPanel tab={panelTab} label={t(`tabs.${panelTab}`)} />
      </section>
    </div>
  )
}

/** Свойства `SettingsPanel`. */
interface SettingsPanelProps {
  /** Показываемая вкладка. */
  tab: SettingsTab
  /** Доступное имя панели. */
  label: string
}

/**
 * Содержимое вкладки. `memo`: пока вкладка та же, панель не перерисовывается вместе с окном
 * (например, при нажатии на переключатель до отложенной смены вкладки).
 * `key` пересоздаёт панель при смене вкладки — так проигрывается анимация появления.
 */
const SettingsPanel = memo(function SettingsPanel({ tab, label }: SettingsPanelProps) {
  return (
    <div key={tab} className="settings-content anim-enter" role="tabpanel" id={`${PANEL_ID}-${tab}`} aria-label={label}>
      {tab === 'general' && <GeneralTab />}
      {tab === 'storage' && <StorageTab />}
      {tab === 'advanced' && <AdvancedTab />}
    </div>
  )
})
