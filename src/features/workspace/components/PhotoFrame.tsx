import { useState } from 'react'
import type { PhotoTransform } from '../hooks/usePhotoTransform'

/** Свойства `PhotoFrame`. */
export interface PhotoFrameProps {
  /** Адрес фото. */
  url: string
  /** Альтернативный текст. */
  alt: string
  /** Масштаб, сдвиг и поворот. */
  transform: PhotoTransform
  /** Вызывается, когда фото загрузилось (только для карточки: она сообщает размер фото). */
  onLoad?: (size: { width: number; height: number }) => void
  /** Вызывается, если фото не открылось. */
  onError?: () => void
}

/**
 * Фото внутри рамки с учётом масштаба, сдвига и поворота.
 * Два слоя: внешний сдвигает, внутренний поворачивает и масштабирует вокруг центра.
 *
 * Пока картинка не загрузилась, её пропорции неизвестны и рамка размечена по заглушке 4:3 —
 * поэтому до загрузки фото скрыто и проявляется уже в правильных пропорциях
 * (иначе на первых кадрах оно растягивалось на всю ширину и затем «сжималось»).
 */
export function PhotoFrame({ url, alt, transform, onLoad, onError }: PhotoFrameProps) {
  const { offset, layout, rotation, scale } = transform
  const [loaded, setLoaded] = useState(false)
  return (
    <span
      className={`photo-pan-layer${loaded ? ' is-loaded' : ''}`}
      style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
    >
      <span
        className="photo-transform"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`,
        }}
      >
        <img
          className="photo-preview"
          src={url}
          alt={alt}
          draggable={false}
          decoding="async"
          onLoad={(event) => {
            onLoad?.({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
            setLoaded(true)
          }}
          onError={onError}
        />
      </span>
    </span>
  )
}
