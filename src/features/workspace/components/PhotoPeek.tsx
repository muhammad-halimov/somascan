import { useTranslation } from 'react-i18next'
import { ImageOffIcon } from '@/components/icons/Icons'
import type { ScanItem } from '../hooks/useScanSession'

/** Свойства `PhotoPeek`. */
export interface PhotoPeekProps {
  /** Соседняя бирка; `null` — следующая пустая ячейка. */
  item: ScanItem | null
  /** С какой стороны от фото: предыдущая бирка — слева, следующая — справа. */
  side: 'previous' | 'next'
}

/**
 * Соседняя бирка рядом с фото, пока его листают свайпом (`usePhotoSwipe`): въезжает следом за пальцем, и когда
 * бирка сменяется, встаёт ровно на место её фото. Выглядит так же, как карточка до загрузки фото: миниатюра
 * (с поворотом бирки), «Без фото» или «Добавить фото». Кнопок нет — это картинка, на неё не нажимают.
 */
export function PhotoPeek({ item, side }: PhotoPeekProps) {
  const { t } = useTranslation('workspace')
  const photo = item && !item.manual && item.photoUrl && !item.hasError ? (item.thumbUrl ?? item.photoUrl) : null
  const sideways = item ? item.rotation % 180 !== 0 : false

  return (
    <div className={`photo-peek is-${side}${photo ? ' has-photo' : ''}`}>
      {photo ? (
        <img
          className={`photo-placeholder${sideways ? ' is-sideways' : ''}`}
          src={photo}
          alt=""
          draggable={false}
          style={item?.rotation ? { rotate: `${item.rotation}deg` } : undefined}
        />
      ) : item?.manual ? (
        <div className="photo-manual">
          <span className="photo-manual-icon"><ImageOffIcon /></span>
          <span className="photo-label">{t('photo.noPhoto')}</span>
          <span className="photo-manual-hint">{t('photo.manualHint')}</span>
        </div>
      ) : (
        <div className="photo-empty">
          <span className="photo-plus" />
          <span className="photo-label">{t('photo.add')}</span>
        </div>
      )}
    </div>
  )
}
