import { useTranslation } from 'react-i18next'
import { AddIcon, ResetIcon, RotateClockwiseIcon, ZoomOutIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import type { PhotoTransform } from '../hooks/usePhotoTransform'

/** Свойства `PhotoControls`. */
export interface PhotoControlsProps {
  /** Состояние масштаба и поворота. */
  transform: PhotoTransform
  /** CSS-класс контейнера (расположение зависит от места: карточка или просмотр). */
  className: string
  /** Показать кнопку «Сброс» — вернуть исходный масштаб, положение и поворот. */
  showReset?: boolean
}

/** Кнопки «меньше», «больше», «поворот» (и «сброс» в просмотре) поверх фото, с подписями. */
export function PhotoControls({ transform, className, showReset = false }: PhotoControlsProps) {
  const { t } = useTranslation('workspace')
  const { canZoomIn, canZoomOut, isPristine, zoomIn, zoomOut, rotate, reset } = transform
  return (
    <div className={className} role="group" aria-label={t('photo.controls')}>
      <ActionButton variant="overlay" size={52} icon={<ZoomOutIcon />} caption={t('controls.zoomOut')} label={t('photo.zoomOut')} disabled={!canZoomOut} onClick={zoomOut} />
      <ActionButton variant="overlay" size={52} icon={<AddIcon />} caption={t('controls.zoomIn')} label={t('photo.zoomIn')} disabled={!canZoomIn} onClick={zoomIn} />
      <ActionButton variant="overlay" size={52} icon={<RotateClockwiseIcon />} caption={t('controls.rotate')} label={t('photo.rotate')} onClick={rotate} />
      {showReset && (
        <ActionButton variant="overlay" size={52} icon={<ResetIcon />} caption={t('controls.reset')} label={t('controls.resetLabel')} disabled={isPristine} onClick={reset} />
      )}
    </div>
  )
}
