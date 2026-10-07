import { useTranslation } from 'react-i18next'
import './OfflineBanner.css'

/** Свойства `OfflineBanner`. */
export interface OfflineBannerProps {
  /** Проигрывается анимация исчезновения (сеть вернулась). */
  isClosing: boolean
}

/** Баннер «Нет подключения к интернету» под шапкой (озвучивается скринридерами). */
export function OfflineBanner({ isClosing }: OfflineBannerProps) {
  const { t } = useTranslation()
  return <div className={`offline-banner${isClosing ? ' is-closing' : ''}`} role="status" aria-live="polite">{t('offline')}</div>
}
