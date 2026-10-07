import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import type { Size } from '../utils/PhotoGeometry'
import { usePhotoTransform } from '../hooks/usePhotoTransform'
import { PhotoControls } from './PhotoControls'
import { PhotoFrame } from './PhotoFrame'
import './PhotoViewer.css'

/** Свойства `PhotoViewer`. */
export interface PhotoViewerProps {
  /** Адрес фото. */
  url: string
  /** Натуральный размер фото. */
  naturalSize: Size | null
  /** Проигрывается анимация закрытия. */
  isClosing: boolean
  /** Закрыть просмотр. */
  onClose: () => void
}

/**
 * Просмотр фото на весь экран: щипок, перетаскивание, кнопки масштаба и поворота.
 * Свой масштаб и поворот, независимые от карточки. Закрывается крестиком,
 * клавишей Escape и системным «Назад».
 */
export function PhotoViewer({ url, naturalSize, isClosing, onClose }: PhotoViewerProps) {
  const { t } = useTranslation(['workspace', 'common'])
  const transform = usePhotoTransform({ naturalSize, enabled: true })
  const { attachFrame, touchHandlers, pointerHandlers } = transform
  useBodyScrollLock(true)

  // Escape на компьютере.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <section className={`photo-viewer${isClosing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-labelledby="photo-viewer-title">
      <header className="photo-viewer-header">
        <h2 id="photo-viewer-title">{t('viewer.title')}</h2>
        <ActionButton variant="ghost" icon={<CloseIcon />} caption={t('common:close')} label={t('viewer.close')} onClick={onClose} />
      </header>
      <div ref={attachFrame} className="photo-viewer-stage" {...touchHandlers} {...pointerHandlers}>
        <PhotoFrame url={url} alt={t('photo.alt')} transform={transform} />
      </div>
      <PhotoControls className="photo-viewer-controls" transform={transform} showReset />
    </section>
  )
}
