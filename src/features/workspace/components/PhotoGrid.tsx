import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertIcon, CheckIcon, ExclamationIcon, ImageOffIcon } from '@/components/icons/Icons'
import { missingManualFields, type LabelFieldDefinition } from '@/features/recognition/label/labelFields'
import { hasProductForm } from '@/features/recognition/label/productForm'
import { useSettings } from '@/features/settings/store/useSettings'
import { MAX_SCAN_ITEMS, type ScanItem } from '../hooks/useScanSession'
import { motionTiming, prefersReducedMotion } from '../utils/motion'
import './PhotoGrid.css'

/** Свойства `PhotoGrid`. */
export interface PhotoGridProps {
  /** Ref сетки: по нему карточка анимирует переход между сеткой и одной биркой. */
  gridRef: RefObject<HTMLDivElement | null>
  /** Бирки по порядку. */
  items: readonly ScanItem[]
  /** Открытая бирка (`items.length` — следующая пустая ячейка). */
  activeIndex: number
  /** Сетка на экране (во время перехода к одной бирке нажатия не принимаются). */
  interactive: boolean
  /** Открыть бирку или следующую пустую ячейку. */
  onOpen: (index: number) => void
  /** Выбрать бирку для отправки или снять выбор. */
  onToggleSelected: (index: number) => void
}

/** Состояние бирки для значка в углу ячейки. */
type CellState = 'busy' | 'failed' | 'noPhoto' | 'noForm' | 'incomplete' | 'done' | 'none'

function cellState(item: ScanItem, fields: readonly LabelFieldDefinition[]): CellState {
  if (item.hasError || item.status.kind === 'failed') return 'failed'
  if (item.status.kind === 'recognizing') return 'busy'
  if (item.status.kind !== 'done') return 'none'
  // Переключена обратно «с фото», а снимка нет.
  if (!item.manual && !item.photoUrl) return 'noPhoto'
  if (!hasProductForm(item.status.label)) return 'noForm'
  // У бирки без фото поля по умолчанию обязательны.
  if (item.manual && missingManualFields(item.status.label, fields).length > 0) return 'incomplete'
  return 'done'
}

/**
 * Сетка 3 × 3 в карточке фото: бирки по порядку (миниатюра или, у бирки без фото, перечёркнутая картинка; номер, состояние),
 * следующая свободная ячейка — «плюс», дальше — недоступные ячейки: заполнять можно только по порядку.
 *
 * Выбранные для отправки бирки обведены акцентным цветом, открытая — контрастным (у выбранной
 * открытой — оба кольца); выбор — «радиокнопка» в левом нижнем углу (кольцо, у выбранной — точка). Состояние — в правом нижнем:
 * спиннер (распознаётся), галочка (готова), оранжевый «!» (не выбрана форма; у бирки без фото — и не заполнены
 * обязательные поля), красный знак (ошибка).
 * Нажатие на ячейку открывает бирку (карточка увеличивает ячейку до одной бирки). Когда бирки уходят
 * (отправка, «Сброс»), оставшиеся плавно переезжают на освободившиеся места.
 */
export function PhotoGrid({ gridRef, items, activeIndex, interactive, onOpen, onToggleSelected }: PhotoGridProps) {
  const { t } = useTranslation('workspace')
  const { advanced } = useSettings()

  // Где стояли ячейки бирок: после отправки или «Сброса» оставшиеся переезжают на освободившиеся места
  // плавно, а не перескакивают (позиции — раскладки, без учёта transform перехода к одной бирке).
  const cellPositions = useRef(new Map<string, { left: number; top: number }>())
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const previous = cellPositions.current
    const next = new Map<string, { left: number; top: number }>()
    const animate = interactive && !prefersReducedMotion()
    for (const cell of grid.querySelectorAll<HTMLElement>('[data-item-id]')) {
      const position = { left: cell.offsetLeft, top: cell.offsetTop }
      const id = cell.dataset.itemId ?? ''
      next.set(id, position)
      const from = previous.get(id)
      if (animate && from && (from.left !== position.left || from.top !== position.top)) {
        cell.animate([{ transform: `translate(${from.left - position.left}px, ${from.top - position.top}px)` }, { transform: 'none' }], motionTiming())
      }
    }
    cellPositions.current = next
  }, [items, interactive, gridRef])

  return (
    <div ref={gridRef} className="photo-grid" role="group" aria-label={t('grid.region')} inert={!interactive || undefined}>
      {Array.from({ length: MAX_SCAN_ITEMS }, (_, index) => {
        const item = items[index]
        const number = index + 1
        const isActive = index === activeIndex
        if (!item) {
          const isNext = index === items.length
          return (
            <div key={`empty-${index}`} className={`photo-grid-cell is-empty ${isNext ? 'is-next' : 'is-locked'}${isActive ? ' is-active' : ''}`}>
              <button
                type="button"
                className="photo-grid-open"
                aria-label={isNext ? t('grid.add', { number }) : t('grid.locked', { number })}
                disabled={!isNext}
                onClick={() => onOpen(index)}
              >
                <span className="photo-grid-plus" aria-hidden="true" />
              </button>
            </div>
          )
        }
        const state = cellState(item, advanced.labelFields)
        const stateText = state === 'none' ? '' : t(`grid.state.${state}`)
        const name = item.manual ? `${t('grid.item', { number })}, ${t('grid.manual')}` : t('grid.item', { number })
        const classes = ['photo-grid-cell', 'has-photo', item.manual && 'is-manual', isActive && 'is-active', item.selected && 'is-selected', state === 'busy' && 'is-busy'].filter(Boolean).join(' ')
        return (
          <div key={item.id} className={classes} data-item-id={item.id}>
            <button
              type="button"
              className="photo-grid-open"
              aria-label={stateText ? `${name}: ${stateText}` : name}
              aria-current={isActive || undefined}
              onClick={() => onOpen(index)}
            >
              {item.thumbUrl && !item.hasError && <img className="photo-grid-thumb" src={item.thumbUrl} alt="" draggable={false} decoding="async" />}
              {/* Бирка без фото — перечёркнутая картинка на месте миниатюры. */}
              {item.manual && <span className="photo-grid-manual" aria-hidden="true"><ImageOffIcon /></span>}
              <span className="photo-grid-number" aria-hidden="true">{number}</span>
              {state === 'busy' && <span className="photo-grid-spinner" aria-hidden="true" />}
              {/* Ждёт фото — «плюс» на месте миниатюры. */}
              {state === 'noPhoto' && <span className="photo-grid-plus" aria-hidden="true" />}
              {(state === 'failed' || state === 'noPhoto' || state === 'noForm' || state === 'incomplete' || state === 'done') && (
                <span className={`photo-grid-badge is-${state === 'incomplete' || state === 'noPhoto' ? 'noForm' : state}`} aria-hidden="true">
                  {state === 'failed' ? <AlertIcon /> : state === 'done' ? <CheckIcon /> : <ExclamationIcon />}
                </span>
              )}
            </button>
            <button
              type="button"
              role="checkbox"
              className="photo-grid-select"
              aria-checked={item.selected}
              aria-label={t('grid.select', { number })}
              onClick={() => onToggleSelected(index)}
            >
              <span className="photo-grid-radio" aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
