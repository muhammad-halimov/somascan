import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertIcon, CheckIcon } from '@/components/icons/Icons'
import { MAX_SCAN_ITEMS, type ScanItem } from '../hooks/useScanSession'
import './PhotoGrid.css'

/** Свойства `PhotoGrid`. */
export interface PhotoGridProps {
  /** Ref сетки: по нему карточка анимирует переход между сеткой и одной биркой. */
  gridRef: Ref<HTMLDivElement>
  /** Бирки по порядку. */
  items: readonly ScanItem[]
  /** Открытая бирка (`items.length` — следующая пустая ячейка). */
  activeIndex: number
  /** Сетка на экране (во время перехода к одной бирке нажатия не принимаются). */
  interactive: boolean
  /** Открыть бирку или следующую пустую ячейку. */
  onOpen: (index: number) => void
}

/**
 * Сетка 3 × 3 в карточке фото: бирки по порядку (миниатюра, номер, состояние распознавания),
 * следующая свободная ячейка — «плюс», дальше — недоступные ячейки: заполнять можно только по порядку.
 * Нажатие открывает бирку (карточка увеличивает ячейку до одной бирки).
 */
export function PhotoGrid({ gridRef, items, activeIndex, interactive, onOpen }: PhotoGridProps) {
  const { t } = useTranslation('workspace')
  return (
    <div ref={gridRef} className="photo-grid" role="group" aria-label={t('grid.region')} inert={!interactive || undefined}>
      {Array.from({ length: MAX_SCAN_ITEMS }, (_, index) => {
        const item = items[index]
        const number = index + 1
        const isActive = index === activeIndex
        if (!item) {
          const isNext = index === items.length
          return (
            <button
              key={`empty-${index}`}
              type="button"
              className={`photo-grid-cell is-empty ${isNext ? 'is-next' : 'is-locked'}${isActive ? ' is-active' : ''}`}
              aria-label={isNext ? t('grid.add', { number }) : t('grid.locked', { number })}
              disabled={!isNext}
              onClick={() => onOpen(index)}
            >
              <span className="photo-grid-plus" aria-hidden="true" />
            </button>
          )
        }
        const isBusy = item.status.kind === 'recognizing' || (item.isLoading && !item.hasError)
        const isFailed = item.hasError || item.status.kind === 'failed'
        const isDone = !isFailed && item.status.kind === 'done'
        const state = isBusy ? t('grid.stateRecognizing') : isFailed ? t('grid.stateFailed') : isDone ? t('grid.stateDone') : ''
        return (
          <button
            key={item.id}
            type="button"
            className={`photo-grid-cell has-photo${isActive ? ' is-active' : ''}${isBusy ? ' is-busy' : ''}`}
            aria-label={state ? `${t('grid.item', { number })}: ${state}` : t('grid.item', { number })}
            aria-current={isActive || undefined}
            onClick={() => onOpen(index)}
          >
            {item.thumbUrl && !item.hasError && <img className="photo-grid-thumb" src={item.thumbUrl} alt="" draggable={false} decoding="async" />}
            <span className="photo-grid-number" aria-hidden="true">{number}</span>
            {isBusy && <span className="photo-grid-spinner" aria-hidden="true" />}
            {(isFailed || isDone) && (
              <span className={`photo-grid-badge ${isFailed ? 'is-failed' : 'is-done'}`} aria-hidden="true">
                {isFailed ? <AlertIcon /> : <CheckIcon />}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
