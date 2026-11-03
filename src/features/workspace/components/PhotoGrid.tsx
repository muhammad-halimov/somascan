import { useLayoutEffect, useRef, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertIcon, CheckIcon, ExclamationIcon, ImageOffIcon } from '@/components/icons/Icons'
import { useSettings } from '@/features/settings/store/useSettings'
import { useGridDragSelect } from '../hooks/useGridDragSelect'
import { useHeatDuplicates } from '../hooks/useHeatDuplicates'
import { MAX_SCAN_ITEMS, type ScanItem } from '../hooks/useScanSession'
import { motionTiming, prefersReducedMotion } from '../utils/motion'
import { attentionTone, tagState } from '../utils/tagState'
import './PhotoGrid.css'

/** Свойства `PhotoGrid`. */
export interface PhotoGridProps {
  /** Ref сетки: по нему карточка анимирует переход между сеткой и одной биркой. */
  gridRef: RefObject<HTMLDivElement | null>
  /** Бирки по порядку. */
  items: readonly ScanItem[]
  /** Открытая бирка (`items.length` — следующая пустая ячейка). */
  activeIndex: number
  /** Открыта одна бирка: сетка прозрачна (но собрана и отрисована — переход к ней не ждёт ни сборки, ни отрисовки). */
  hidden: boolean
  /** Сетка на экране (во время перехода к одной бирке нажатия не принимаются). */
  interactive: boolean
  /** Перенести рамку на бирку, не выходя из сетки (нажатие на другую бирку, перенос рамки пальцем). */
  onSelect: (index: number) => void
  /** Открыть бирку (нажатие на бирку под рамкой) или следующую пустую ячейку (нажатие на «плюс»). */
  onOpen: (index: number) => void
  /** Выбрать бирку для отправки или снять выбор. */
  onToggleSelected: (index: number) => void
}

/**
 * Сетка 3 × 3 в карточке фото: бирки по порядку (миниатюра или, у бирки без фото, перечёркнутая картинка; номер, состояние),
 * следующая свободная ячейка — «плюс», дальше — недоступные ячейки: заполнять можно только по порядку.
 *
 * Выбор для отправки — флажок с белой кромкой в левом нижнем углу (у выбранной бирки — с галочкой,
 * у остальных пустой, миниатюра притушена),
 * открытая бирка — в акцентной обводке. Состояние — в правом нижнем:
 * спиннер (распознаётся), галочка (готова), красный «!» (не выбрана форма), жёлтый «!» (не распознаны обязательные
 * поля, плавка повторяется или нет фото), красный знак (ошибка).
 * Нажатие на бирку под рамкой открывает её (карточка увеличивает ячейку до одной бирки), на другую бирку — переносит
 * на неё рамку, не выходя из сетки (карточка результата показывает её данные); «плюс» открывается нажатием. Рамку можно
 * вести пальцем по ячейкам сетки (`useGridDragSelect`). Когда бирки уходят
 * (отправка, «Сброс»), оставшиеся плавно переезжают на освободившиеся места.
 */
export function PhotoGrid({ gridRef, items, activeIndex, hidden, interactive, onSelect, onOpen, onToggleSelected }: PhotoGridProps) {
  const { t } = useTranslation('workspace')
  const { advanced } = useSettings()
  const duplicates = useHeatDuplicates(items)

  // Рамку открытой бирки ведёт палец: она переезжает с ячейки на ячейку под пальцем.
  const frameRef = useRef<HTMLSpanElement>(null)
  useGridDragSelect({ gridRef, frameRef, activeIndex, enabled: interactive, onSelect })

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
    <div ref={gridRef} className={`photo-grid${hidden ? ' is-hidden' : ''}`} role="group" aria-label={t('grid.region')} inert={!interactive || undefined}>
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
        const state = tagState(item, advanced.labelFields, duplicates)
        const tone = attentionTone(state)
        const stateText = state === 'none' ? '' : t(`grid.state.${state}`)
        const name = item.manual ? `${t('grid.item', { number })}, ${t('grid.manual')}` : t('grid.item', { number })
        const classes = ['photo-grid-cell', 'has-photo', item.manual && 'is-manual', isActive && 'is-active', item.selected && 'is-selected', state === 'busy' && 'is-busy'].filter(Boolean).join(' ')
        return (
          <div key={item.id} className={classes} data-item-id={item.id} data-item-index={index}>
            <button
              type="button"
              className="photo-grid-open"
              aria-label={stateText ? `${name}: ${stateText}` : name}
              aria-current={isActive || undefined}
              onClick={() => (isActive ? onOpen(index) : onSelect(index))}
            >
              {/* Миниатюра — с поворотом бирки, как фото в карточке. */}
              {item.thumbUrl && !item.hasError && (
                <img
                  className={`photo-grid-thumb${item.rotation % 180 !== 0 ? ' is-sideways' : ''}`}
                  style={item.rotation ? { rotate: `${item.rotation}deg` } : undefined}
                  src={item.thumbUrl}
                  alt=""
                  draggable={false}
                  decoding="async"
                />
              )}
              {/* Бирка без фото — перечёркнутая картинка на месте миниатюры. */}
              {item.manual && <span className="photo-grid-manual" aria-hidden="true"><ImageOffIcon /></span>}
              <span className="photo-grid-number" aria-hidden="true">{number}</span>
              {state === 'busy' && <span className="photo-grid-spinner" aria-hidden="true" />}
              {/* Ждёт фото — «плюс» на месте миниатюры. */}
              {state === 'noPhoto' && <span className="photo-grid-plus" aria-hidden="true" />}
              {(state === 'failed' || state === 'done' || tone) && (
                <span className={`photo-grid-badge is-${tone ?? state}`} aria-hidden="true">
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
              <span className="photo-grid-check" aria-hidden="true"><CheckIcon /></span>
            </button>
          </div>
        )
      })}
      {/* Рамка, которую ведёт палец (`useGridDragSelect`): видна только во время переноса. */}
      <span ref={frameRef} className="photo-grid-frame" aria-hidden="true" />
    </div>
  )
}
