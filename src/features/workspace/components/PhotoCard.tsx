import { useTranslation } from 'react-i18next'
import { usePresence } from '@/hooks/usePresence'
import type { Size } from '../utils/PhotoGeometry'
import type { PhotoTransform } from '../hooks/usePhotoTransform'
import { PhotoControls } from './PhotoControls'
import { PhotoFrame } from './PhotoFrame'
import './PhotoCard.css'

/** Свойства `PhotoCard`. */
export interface PhotoCardProps {
  /** Фото или `null` для пустого состояния «Добавить фото». */
  photoUrl: string | null
  /** Меняется у каждого нового фото, чтобы `<img>` пересоздавался даже при том же адресе. */
  photoKey: number
  /** Фото ещё загружается. */
  isLoading: boolean
  /** Идёт распознавание. */
  isRecognizing: boolean
  /** Фото не открылось. */
  hasError: boolean
  /** Масштаб, сдвиг, поворот и обработчики жестов. */
  transform: PhotoTransform
  /** Открывает источник фото (пустое состояние). */
  onPick: () => void
  /** Открывает фото на весь экран. */
  onOpen: () => void
  /** Фото загрузилось; передаёт его натуральный размер. */
  onLoad: (size: Size) => void
  /** Фото не загрузилось. */
  onError: () => void
}

/**
 * Карточка фото: пустая кнопка «Добавить фото» или фото с жестами (щипок, перетаскивание),
 * кнопками масштаба и поворота. Нажатие на фото открывает просмотр на весь экран.
 * Пока фото грузится и распознаётся — один спиннер с подписью «Распознавание».
 */
export function PhotoCard({ photoUrl, photoKey, isLoading, isRecognizing, hasError, transform, onPick, onOpen, onLoad, onError }: PhotoCardProps) {
  const { t } = useTranslation('workspace')
  // Деструктурируем отдельно: callback-ref не должен смешиваться с данными для рендера.
  const { attachFrame, isZoomed, wasGesture, touchHandlers, pointerHandlers } = transform
  const hasPhoto = Boolean(photoUrl) && !hasError
  const isBusy = isLoading || isRecognizing
  const overlay = usePresence(isBusy)
  const classes = ['photo-card', hasPhoto && 'has-photo', isZoomed && 'is-zoomed'].filter(Boolean).join(' ')

  return (
    <div className={classes} aria-busy={isBusy} {...touchHandlers}>
      {photoUrl && !hasError && (
        <button
          ref={attachFrame}
          type="button"
          className="photo-image-action"
          aria-label={t('photo.open')}
          // Нажатие сразу после перетаскивания или щипка — не «тап», просмотр не открываем.
          onClick={(event) => !wasGesture(event.timeStamp) && onOpen()}
          {...pointerHandlers}
        >
          <PhotoFrame key={photoKey} url={photoUrl} alt={t('photo.alt')} transform={transform} onLoad={onLoad} onError={onError} />
        </button>
      )}

      {overlay.mounted && (
        <div className={`photo-loading${overlay.closing ? ' is-closing' : ''}`} role="status">
          <span className="photo-spinner" aria-hidden="true" />
          {/* Загрузка выбранного фото — часть распознавания: для пользователя это один этап. */}
          <span className="photo-label">{t('photo.recognizing')}</span>
        </div>
      )}

      {/* Пока идёт загрузка, пустое состояние не показываем: подпись спиннера его заменяет. */}
      {!hasPhoto && !isBusy && (
        <button className="photo-empty anim-fade" type="button" aria-label={t('photo.add')} onClick={onPick}>
          <span className="photo-plus" aria-hidden="true" />
          <span className="photo-label">{hasError ? t('photo.failedToOpen') : t('photo.add')}</span>
        </button>
      )}

      {hasPhoto && !isBusy && <PhotoControls className="photo-controls anim-enter" transform={transform} showReset />}
    </div>
  )
}
