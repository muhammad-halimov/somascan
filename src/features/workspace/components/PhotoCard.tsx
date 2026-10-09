import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { BackIcon, GridIcon, ImageIcon, ImageOffIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { usePresence } from '@/hooks/usePresence'
import type { ScanItem } from '../hooks/useScanSession'
import type { Size } from '../utils/PhotoGeometry'
import type { PhotoTransform } from '../hooks/usePhotoTransform'
import { motionTiming, prefersReducedMotion } from '../utils/motion'
import { PhotoControls } from './PhotoControls'
import { PhotoFrame } from './PhotoFrame'
import { PhotoGrid } from './PhotoGrid'
import './PhotoCard.css'

/** Что показывает карточка: одну бирку или сетку всех. */
export type PhotoCardView = 'single' | 'grid'

/** Что улетает к «Загрузкам» при отправке и что на это время гаснет. */
export interface SendTargets {
  fly: HTMLElement[]
  hide: HTMLElement[]
}

/** Команды карточке фото. */
export interface PhotoCardHandle {
  /**
   * Элементы «отправки» бирок `ids`: в сетке — их ячейки, у одной бирки — её фото (если она среди
   * отправленных; кнопки масштаба и поворота над ним гаснут).
   */
  sendTargets: (ids: ReadonlySet<string>) => SendTargets
}

/** Свойства `PhotoCard`. */
export interface PhotoCardProps {
  /** Команды карточке (анимация отправки). */
  handleRef?: Ref<PhotoCardHandle>
  /** Открытая бирка или `null` — пустая ячейка «Добавить фото». */
  item: ScanItem | null
  /** Все бирки по порядку (для сетки). */
  items: readonly ScanItem[]
  /** Номер открытой бирки (`items.length` — пустая ячейка). */
  activeIndex: number
  /** Одна бирка или сетка. */
  view: PhotoCardView
  /** Показывать «Назад» (к сетке): бирку открыли из сетки. */
  showBack: boolean
  /** Пользователь вернулся из системного выбора фото, а оно ещё готовится. */
  isReceiving: boolean
  /** Масштаб, сдвиг, поворот и обработчики жестов открытого фото. */
  transform: PhotoTransform
  /** Открывает источник фото (пустая ячейка). */
  onPick: () => void
  /** Угловая кнопка «Без фото» / «С фото»: переключает ячейку между фото и вводом данных вручную. */
  onToggleManual: () => void
  /** Открывает фото на весь экран. */
  onOpen: () => void
  /** Фото загрузилось; передаёт его натуральный размер. */
  onLoad: (size: Size) => void
  /** Фото не загрузилось. */
  onError: () => void
  /** «Сетка» или «Назад»: показать все бирки. */
  onShowGrid: () => void
  /** Ячейка сетки: открыть бирку или следующую пустую ячейку. */
  onOpenCell: (index: number) => void
  /** Кнопка в углу сетки: открыть выбранную бирку (та же, что «Открыть» в панели листания). */
  onOpenActive: () => void
  /** Значок выбора в ячейке: отправлять бирку или нет. */
  onToggleSelected: (index: number) => void
}

/**
 * Карточка фото: открытая бирка (пустая кнопка «Добавить фото» или фото с жестами — щипок,
 * перетаскивание, — кнопками масштаба и поворота) или сетка 3 × 3 всех бирок.
 *
 * Справа вверху — «Сетка»: карточка уменьшает фото в его ячейку, и появляется сетка; нажатие
 * на ячейку (или «Открыть» — в углу сетки и в панели под карточкой) увеличивает её обратно до одной бирки. Слева
 * вверху у бирки, открытой из сетки, — «Назад» к сетке. Переход к соседней бирке — фото въезжает
 * сбоку, как слайд. Нажатие на фото открывает просмотр на весь экран. Пока фото грузится и распознаётся —
 * один спиннер с подписью «Распознавание». В правом нижнем углу ячейки без снимка — переключатель «Без фото» /
 * «С фото»: бирка, данные которой вводят вручную (на месте фото — перечёркнутая картинка), и обратно.
 */
export function PhotoCard({ handleRef, item, items, activeIndex, view, showBack, isReceiving, transform, onPick, onToggleManual, onOpen, onLoad, onError, onShowGrid, onOpenCell, onOpenActive, onToggleSelected }: PhotoCardProps) {
  const { t } = useTranslation('workspace')
  // Деструктурируем отдельно: callback-ref не должен смешиваться с данными для рендера.
  const { attachFrame, isZoomed, wasGesture, touchHandlers, pointerHandlers } = transform
  const photoUrl = item?.photoUrl ?? null
  const hasError = item?.hasError ?? false
  const hasPhoto = Boolean(photoUrl) && !hasError
  const isManual = item?.manual ?? false
  const isBusy = isReceiving || (item !== null && (item.isLoading || item.status.kind === 'recognizing') && !hasError)
  const overlay = usePresence(isBusy)
  const gridSingle = usePresence(view === 'grid')
  /** Бирка, чьё фото уже загрузилось в карточке: до этого вместо него — миниатюра (фото с телефона декодируется не сразу). */
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const placeholder = hasPhoto && item?.thumbUrl && item.thumbUrl !== photoUrl && loadedId !== item.id ? item.thumbUrl : null

  const cardRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  /** Сетка в DOM: с начала перехода к ней и до конца перехода обратно. */
  const [gridMounted, setGridMounted] = useState(view === 'grid')
  if (view === 'grid' && !gridMounted) setGridMounted(true)
  /** Вид после окончания перехода: пока переход идёт, видны оба слоя. */
  const [settledView, setSettledView] = useState(view)
  const shownView = useRef(view)
  const activeIndexRef = useRef(activeIndex)
  useLayoutEffect(() => {
    activeIndexRef.current = activeIndex
  }, [activeIndex])

  // Переход между сеткой и одной биркой — «камера» отъезжает от фото к сетке и наезжает обратно:
  // фото уменьшается в свою ячейку, сетка увеличивается из неё (и наоборот).
  useLayoutEffect(() => {
    if (shownView.current === view) return
    shownView.current = view
    const finish = () => {
      // Сразу в DOM: иначе между концом анимации и отрисовкой React мелькнул бы прежний слой
      // (например, сетка целиком — в конце перехода к одной бирке).
      flushSync(() => {
        setSettledView(view)
        if (view === 'single') setGridMounted(false)
      })
    }
    const card = cardRef.current
    const stage = stageRef.current
    const grid = gridRef.current
    const cell = grid?.children[activeIndexRef.current]
    if (!card || !stage || !grid || !(cell instanceof HTMLElement) || prefersReducedMotion()) {
      finish()
      return
    }
    // На время перехода — без размытия под кнопками (дорого для композитора, переход дёргался бы)
    // и без увеличения открытой ячейки: её размер меряем уже обычным.
    card.classList.add('is-zooming')
    const box = card.getBoundingClientRect()
    const rect = cell.getBoundingClientRect()
    const scale = rect.width / box.width
    const cx = rect.left - box.left + rect.width / 2
    const cy = rect.top - box.top + rect.height / 2
    // Фото в ячейке и сетка, увеличенная так, что ячейка закрывает карточку (transform-origin — левый верхний угол).
    const stageInCell = `translate(${cx - (box.width / 2) * scale}px, ${cy - (box.height / 2) * scale}px) scale(${scale})`
    const gridAtCell = `translate(${box.width / 2 - cx / scale}px, ${box.height / 2 - cy / scale}px) scale(${1 / scale})`
    // Фото в ячейке скруглено, как ячейка (радиус — в масштабе уменьшенного фото).
    const cellRadius = `${Number.parseFloat(getComputedStyle(cell).borderTopLeftRadius) / scale || 0}px`
    const timing = { ...motionTiming(), fill: 'both' as const }
    const animations = view === 'grid'
      ? [
          stage.animate([
            { transform: 'none', opacity: 1, borderRadius: '0px' },
            { opacity: 0, offset: 0.5 },
            { transform: stageInCell, opacity: 0, borderRadius: cellRadius },
          ], timing),
          grid.animate([{ transform: gridAtCell, opacity: 0 }, { opacity: 1, offset: 0.35 }, { transform: 'none', opacity: 1 }], timing),
        ]
      : [
          stage.animate([
            { transform: stageInCell, opacity: 0, borderRadius: cellRadius },
            { opacity: 1, offset: 0.55 },
            { transform: 'none', opacity: 1, borderRadius: '0px' },
          ], timing),
          grid.animate([{ transform: 'none', opacity: 1 }, { opacity: 1, offset: 0.4 }, { transform: gridAtCell, opacity: 0 }], timing),
        ]
    let cancelled = false
    void Promise.all(animations.map((animation) => animation.finished)).then(() => {
      if (cancelled) return
      finish()
      animations.forEach((animation) => animation.cancel())
      card.classList.remove('is-zooming')
    }, () => undefined)
    return () => {
      cancelled = true
      animations.forEach((animation) => animation.cancel())
      card.classList.remove('is-zooming')
    }
  }, [view])

  // Другая бирка в одиночном виде — слайд: фото въезжает с той стороны, куда листали
  // (после «Далее» и «Сброса» бирка меняется на месте — только проявляется).
  const shownSlide = useRef({ id: item?.id ?? null, index: activeIndex })
  useLayoutEffect(() => {
    const previous = shownSlide.current
    shownSlide.current = { id: item?.id ?? null, index: activeIndex }
    const stage = stageRef.current
    if (!stage || view !== 'single' || settledView !== 'single' || previous.id === (item?.id ?? null) && previous.index === activeIndex) return
    if (prefersReducedMotion()) return
    const direction = Math.sign(activeIndex - previous.index)
    const animation = stage.animate(
      [{ transform: `translateX(${direction * 36}px)`, opacity: direction === 0 ? 0.3 : 0.2 }, { transform: 'none', opacity: 1 }],
      { duration: 280, easing: motionTiming().easing },
    )
    return () => animation.cancel()
  }, [item?.id, activeIndex, view, settledView])

  const itemIdRef = useRef(item?.id ?? null)
  useLayoutEffect(() => {
    itemIdRef.current = item?.id ?? null
  }, [item?.id])
  useImperativeHandle(handleRef, () => ({
    sendTargets(ids) {
      if (shownView.current === 'grid') {
        const cells = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-item-id]') ?? [])
        return { fly: cells.filter((cell) => ids.has(cell.dataset.itemId ?? '')), hide: [] }
      }
      const stage = stageRef.current
      if (!stage || !ids.has(itemIdRef.current ?? '')) return { fly: [], hide: [] }
      // Улетает фото (у бирки без фото — её заглушка), кнопки масштаба и поворота над ним гаснут.
      const photo = stage.querySelector<HTMLElement>('.photo-image-action, .photo-manual')
      return { fly: photo ? [photo] : [], hide: Array.from(stage.querySelectorAll<HTMLElement>('.photo-controls')) }
    },
  }), [])

  const isGridShown = view === 'grid' && settledView === 'grid'
  // `is-grid` — сетка на экране и переход закончился: свечение открытой ячейки выходит за края карточки.
  const classes = ['photo-card', hasPhoto && view === 'single' && 'has-photo', isZoomed && 'is-zoomed', isGridShown && 'is-grid'].filter(Boolean).join(' ')

  return (
    <div ref={cardRef} className={classes} aria-busy={isBusy && view === 'single'} {...touchHandlers}>
      <div ref={stageRef} className={`photo-stage${isGridShown ? ' is-hidden' : ''}`} inert={view === 'grid' || undefined}>
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
            {placeholder && <img className="photo-placeholder" src={placeholder} alt="" draggable={false} />}
            <PhotoFrame
              key={item?.id}
              url={photoUrl}
              alt={t('photo.alt')}
              transform={transform}
              onLoad={(size) => {
                setLoadedId(item?.id ?? null)
                onLoad(size)
              }}
              onError={onError}
            />
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
        {!hasPhoto && !isBusy && !isManual && (
          <button key={`empty-${activeIndex}`} className="photo-empty anim-fade" type="button" aria-label={t('photo.add')} onClick={onPick}>
            <span className="photo-plus" aria-hidden="true" />
            <span className="photo-label">{hasError ? t('photo.failedToOpen') : t('photo.add')}</span>
          </button>
        )}

        {/* Бирка без фото: на месте фото — перечёркнутая картинка, данные — в карточке результата. */}
        {isManual && (
          <div key={`manual-${item?.id}`} className="photo-manual anim-fade" role="img" aria-label={t('photo.noPhoto')}>
            <span className="photo-manual-icon" aria-hidden="true"><ImageOffIcon /></span>
            <span className="photo-label">{t('photo.noPhoto')}</span>
            <span className="photo-manual-hint">{t('photo.manualHint')}</span>
          </div>
        )}

        {/*
          Ячейка без снимка (пустая, «без фото» или ждущая фото): в правом нижнем углу — переключатель
          «Без фото» ↔ «С фото», туда и обратно.
        */}
        {!hasPhoto && !isBusy && (
          <div className="photo-corner">
            {isManual ? (
              <ActionButton key="with-photo" className="anim-fade" variant="overlay" size={44} icon={<ImageIcon />} caption={t('photo.withPhoto')} label={t('photo.withPhotoLabel')} onClick={onToggleManual} />
            ) : (
              <ActionButton key="no-photo" className="anim-fade" variant="overlay" size={44} icon={<ImageOffIcon />} caption={t('photo.noPhoto')} label={t('photo.noPhotoLabel')} onClick={onToggleManual} />
            )}
          </div>
        )}

        {hasPhoto && !isBusy && <PhotoControls className="photo-controls anim-enter" transform={transform} showReset />}

        {/* Переходы: «Назад» к сетке слева, «Сетка» справа — над фото и над спиннером распознавания. */}
        <div className="photo-nav">
          {showBack && (
            <ActionButton variant="overlay" size={44} icon={<BackIcon />} caption={t('grid.back')} label={t('grid.backLabel')} onClick={onShowGrid} />
          )}
          <ActionButton className="photo-nav-grid" variant="overlay" size={44} icon={<GridIcon />} caption={t('grid.open')} label={t('grid.openLabel')} onClick={onShowGrid} />
        </div>
      </div>

      {gridMounted && (
        <PhotoGrid gridRef={gridRef} items={items} activeIndex={activeIndex} interactive={view === 'grid'} onOpen={onOpenCell} onToggleSelected={onToggleSelected} />
      )}

      {/* В сетке — «Открыть» выбранную бирку на месте «Сетки», с подписью (дублирует кнопку панели листания); уходит, растворяясь. */}
      {gridSingle.mounted && (
        <ActionButton
          className={`photo-grid-single anim-fade${gridSingle.closing ? ' is-closing' : ''}`}
          inert={gridSingle.closing || undefined}
          variant="overlay"
          size={44}
          icon={<ImageIcon />}
          caption={t('grid.single')}
          label={t('slides.openLabel')}
          onClick={onOpenActive}
        />
      )}

    </div>
  )
}
