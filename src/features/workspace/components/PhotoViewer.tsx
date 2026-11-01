import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CloseIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import type { Size } from '../utils/PhotoGeometry'
import { useDoubleTap } from '../hooks/useDoubleTap'
import { usePhotoTransform } from '../hooks/usePhotoTransform'
import { useSwipeToClose } from '../hooks/useSwipeToClose'
import { PhotoControls } from './PhotoControls'
import { PhotoFrame } from './PhotoFrame'
import './PhotoViewer.css'

/** Свойства `PhotoViewer`. */
export interface PhotoViewerProps {
  /** Адрес фото. */
  url: string
  /** Натуральный размер фото. */
  naturalSize: Size | null
  /** Поворот фото бирки (по часовой стрелке): просмотр открывается с ним и меняет его. */
  rotation: number
  /** Новый поворот фото бирки. */
  onRotationChange: (rotation: number) => void
  /** Проигрывается анимация закрытия. */
  isClosing: boolean
  /** Закрыть просмотр. */
  onClose: () => void
}

/**
 * Просмотр фото на весь экран: фото — во весь экран, заголовок и кнопки висят поверх него. Щипок, перетаскивание,
 * кнопки масштаба и поворота. Свой масштаб, независимый от карточки; поворот — общий с биркой (его же получит
 * распознавание). Двойное нажатие плавно увеличивает фото к точке нажатия (у увеличенного — исходный вид).
 * Свайп вверх или вниз закрывает просмотр (`useSwipeToClose`).
 * Закрывается крестиком, клавишей Escape и системным «Назад».
 */
export function PhotoViewer({ url, naturalSize, rotation, onRotationChange, isClosing, onClose }: PhotoViewerProps) {
  const { t } = useTranslation(['workspace', 'common'])
  const transform = usePhotoTransform({ naturalSize, enabled: true, rotation, onRotationChange })
  const { attachFrame, isZoomed, wasGesture, touchHandlers, pointerHandlers } = transform
  // Свайп вверх или вниз закрывает просмотр (у увеличенного фото палец двигает фото).
  const viewerRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  useSwipeToClose({ viewerRef, stageRef, enabled: !isZoomed && !isClosing, onClose })
  /** Сцена: и рамка для масштаба (`attachFrame`), и цель свайпа закрытия. */
  const attachStage = useCallback((element: HTMLDivElement | null) => {
    stageRef.current = element
    return attachFrame(element)
  }, [attachFrame])
  /** Двойное нажатие — увеличение к пальцу, у увеличенного фото — исходный масштаб (как в карточке). */
  const tapStage = useDoubleTap<string>({ onDouble: (_, point) => transform.toggleZoomAt(point) })
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
    <section ref={viewerRef} className={`photo-viewer${isClosing ? ' is-closing' : ''}`} role="dialog" aria-modal="true" aria-labelledby="photo-viewer-title">
      <header className="photo-viewer-header">
        <h2 id="photo-viewer-title">{t('viewer.title')}</h2>
        <ActionButton variant="overlay" icon={<CloseIcon />} caption={t('common:close')} label={t('viewer.close')} onClick={onClose} />
      </header>
      <div
        ref={attachStage}
        className="photo-viewer-stage"
        onPointerDownCapture={(event) => tapStage.onPress(url, event)}
        onClick={(event) => !wasGesture(event.timeStamp) && tapStage.onTap(url, event)}
        {...touchHandlers}
        {...pointerHandlers}
      >
        <PhotoFrame url={url} alt={t('photo.alt')} transform={transform} />
      </div>
      <PhotoControls className="photo-viewer-controls" transform={transform} showReset />
    </section>
  )
}
