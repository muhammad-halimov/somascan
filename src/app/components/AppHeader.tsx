import { useTranslation } from 'react-i18next'
import { SettingsIcon, UploadIcon } from '@/components/icons/Icons'
import faviconUrl from '@/assets/favicon.ico'
import { ActionButton } from '@/components/ui/ActionButton'
import { uploadStore } from '@/features/uploads/queue/appQueue'
import { hasFailed, pendingCount } from '@/features/uploads/store/UploadStore'
import { useStore } from '@/lib/store/useStore'
import type { AppPanel } from '../App'
import './AppHeader.css'

/** Свойства `AppHeader`. */
export interface AppHeaderProps {
  /** Открытая сейчас панель — её кнопка подсвечена. */
  openPanel: AppPanel | null
  /** Открывает или закрывает панель. */
  onTogglePanel: (panel: AppPanel) => void
}

/**
 * Шапка: логотип и рядом название приложения, кнопки «Загрузки» (со счётчиком очереди) и «Настройки»
 * с подписями. Название — шрифтом высотой с логотип; если до кнопок места меньше, оно уменьшается само.
 */
export function AppHeader({ openPanel, onTogglePanel }: AppHeaderProps) {
  const { t } = useTranslation(['common', 'uploads', 'settings'])
  const appName = t('appName')
  const uploads = useStore(uploadStore)
  const pending = pendingCount(uploads)
  const failed = hasFailed(uploads)

  return (
    <header className="app-header">
      {/* Логотип — не ссылка: переход на «/» перезагружал бы весь экран приложения. */}
      <div className="brand" role="img" aria-label={appName}>
        <img src={faviconUrl} alt="" draggable={false} />
      </div>
      {/* Подпись дублирует имя логотипа (`aria-label` выше) — экранному диктору её не читаем. */}
      <div className="brand-name" aria-hidden="true">
        <span className="brand-name-text">{appName}</span>
      </div>
      <nav className="header-actions" aria-label={t('mainMenu')}>
        <ActionButton
          variant="ghost"
          icon={<UploadIcon />}
          caption={t('uploads:title')}
          badge={pending > 0 ? pending : failed ? 'alert' : undefined}
          badgeTone={failed ? 'danger' : 'accent'}
          active={openPanel === 'uploads'}
          aria-expanded={openPanel === 'uploads'}
          onClick={() => onTogglePanel('uploads')}
          // Сюда прилетают фото отправленных бирок (см. workspace/utils/sendFlight.ts).
          data-fly-target="uploads"
        />
        <ActionButton
          variant="ghost"
          icon={<SettingsIcon />}
          caption={t('settings:title')}
          active={openPanel === 'settings'}
          aria-haspopup="dialog"
          aria-expanded={openPanel === 'settings'}
          onClick={() => onTogglePanel('settings')}
        />
      </nav>
    </header>
  )
}
