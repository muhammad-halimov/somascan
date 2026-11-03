import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ImageIcon, ImageOffIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { usePresence } from '@/hooks/usePresence'
import { useDoubleTap } from '../hooks/useDoubleTap'
import { usePhotoSwipe } from '../hooks/usePhotoSwipe'
import type { ScanItem } from '../hooks/useScanSession'
import type { Size } from '../utils/PhotoGeometry'
import type { PhotoTransform } from '../hooks/usePhotoTransform'
import { motionTiming, prefersReducedMotion } from '../utils/motion'
import type { RetakeHintReason } from '../utils/retakeHint'
import { photoState } from '../utils/photoState'
import { PhotoControls } from './PhotoControls'
import { PhotoFrame } from './PhotoFrame'
import { PhotoGrid } from './PhotoGrid'
import { RetakeHint } from './RetakeHint'
import './PhotoCard.css'

/** Сколько проявляется показанное фото (`.photo-pan-layer.is-loaded` в PhotoCard.css, 260 мс), с запасом на кадр. */
const PHOTO_FADE_MS = 300
/** Переход к соседней бирке: фото въезжает сбоку, мс. */
const SLIDE_MS = 280

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
  /** Пользователь вернулся из системного выбора фото, а оно ещё готовится. */
  isReceiving: boolean
  /** Масштаб, сдвиг, поворот и обработчики жестов открытого фото. */
  transform: PhotoTransform
  /** Кнопки масштаба и поворота — поверх фото (иначе они в панели листания, см. «Расширенные» → «Оформление»). */
  toolsOnPhoto: boolean
  /** Бирка распознана не полностью: сверху на фото — подсказка, что мешает (`retakeHintReason`); `null` — без неё. */
  retakeHint: RetakeHintReason | null
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
  /** Показать все бирки: свайп по фото сверху вниз (как «Сетка» в панели листания). */
  onShowGrid: () => void
  /** Предыдущая бирка (свайп по фото вправо); нет — первая открыта. */
  onPrevious?: () => void
  /** Следующая бирка (свайп по фото влево); нет — открыта последняя ячейка. */
  onNext?: () => void
  /** Ячейка сетки, одно нажатие: бирка становится открытой, сетка остаётся. */
  onSelectCell: (index: number) => void
  /** Ячейка сетки, двойное нажатие (у «плюса» — одно): открыть бирку или следующую пустую ячейку. */
  onOpenCell: (index: number) => void
  /** Значок выбора в ячейке: отправлять бирку или нет. */
  onToggleSelected: (index: number) => void
}

/**
 * Карточка фото: открытая бирка (пустая кнопка «Добавить фото» или фото с жестами — щипок,
 * перетаскивание, — кнопками масштаба и поворота) или сетка 3 × 3 всех бирок.
 *
 * «Сетка» в панели листания (или свайп сверху вниз): карточка уменьшает фото в его ячейку, и появляется сетка;
 * нажатие на ячейку (или «Открыть» в панели) увеличивает её обратно до одной бирки. Переход к соседней бирке — фото въезжает
 * сбоку, как слайд; к соседней бирке листают и свайпом по фото вбок, к сетке — свайпом сверху вниз (`usePhotoSwipe`). Нажатие на фото открывает просмотр на весь экран, двойное нажатие — плавно увеличивает фото
 * к точке нажатия (у увеличенного — исходный вид). Пока фото грузится и распознаётся —
 * один спиннер с подписью «Распознавание». В правом верхнем углу ячейки без снимка — переключатель «Без фото» /
 * «С фото»: бирка, данные которой вводят вручную (на месте фото — перечёркнутая картинка), и обратно.
 */
export function PhotoCard({ handleRef, item, items, activeIndex, view, isReceiving, transform, toolsOnPhoto, retakeHint, onPick, onToggleManual, onOpen, onLoad, onError, onShowGrid, onPrevious, onNext, onSelectCell, onOpenCell, onToggleSelected }: PhotoCardProps) {
  const { t } = useTranslation('workspace')
  // Деструктурируем отдельно: callback-ref не должен смешиваться с данными для рендера.
  const { attachFrame, isZoomed, wasGesture, touchHandlers, pointerHandlers } = transform
  const photoUrl = item?.photoUrl ?? null
  const hasError = item?.hasError ?? false
  const { hasPhoto, isBusy } = photoState(item, isReceiving)
  const isManual = item?.manual ?? false
  /** Нажатие на фото открывает просмотр, двойное — увеличивает фото к пальцу (у увеличенного — исходный вид). */
  const tapPhoto = useDoubleTap<string>({ onSingle: () => onOpen(), onDouble: (_, point) => transform.toggleZoomAt(point) })
  const overlay = usePresence(isBusy)
  /**
   * Бирка, чьё фото уже показано в карточке: до этого на его месте — миниатюра (фото с телефона декодируется
   * не сразу). Миниатюра уходит, когда фото проявилось поверх неё, — между ними нет пустой рамки.
   */
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const placeholder = hasPhoto && item?.thumbUrl && item.thumbUrl !== photoUrl && loadedId !== item.id ? item.thumbUrl : null
  /** Подсказка, что мешает, — у показанного фото; появляется и уходит плавно (уходит с прежним текстом). */
  const hint = usePresence(retakeHint !== null && hasPhoto && !isBusy)
  const [hintReason, setHintReason] = useState(retakeHint)
  if (retakeHint !== null && retakeHint !== hintReason) setHintReason(retakeHint)

  const cardRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  /** Вид после окончания перехода: пока переход идёт, видны оба слоя. */
  const [settledView, setSettledView] = useState(view)
  const shownView = useRef(view)
  const activeIndexRef = useRef(activeIndex)
  useLayoutEffect(() => {
    activeIndexRef.current = activeIndex
  }, [activeIndex])

  // Свайпы по фото одной бирки — как стрелки и кнопка «Сетка»: вбок — к соседней бирке, вниз — к сетке
  // (у увеличенного фото палец двигает фото).
  usePhotoSwipe({ cardRef, enabled: view === 'single' && settledView === 'single' && !isZoomed, onPrevious, onNext, onDown: onShowGrid })

  // Переход между сеткой и одной биркой — «камера» отъезжает от фото к сетке и наезжает обратно:
  // фото уменьшается в свою ячейку, сетка увеличивается из неё (и наоборот).
  useLayoutEffect(() => {
    if (shownView.current === view) return
    shownView.current = view
    const finish = () => {
      // Сразу в DOM: иначе между концом анимации и отрисовкой React мелькнул бы прежний слой
      // (например, сетка целиком — в конце перехода к одной бирке).
      flushSync(() => setSettledView(view))
    }
    const card = cardRef.current
    const stage = stageRef.current
    const grid = gridRef.current
    const cell = grid?.children[activeIndexRef.current]
    if (!card || !stage || !grid || !(cell instanceof HTMLElement) || prefersReducedMotion()) {
      finish()
      return
    }
    // На время перехода — без размытия под кнопками (дорого для композитора, переход дёргался бы) и без колец ячеек.
    // Анимируются только `transform` и `opacity`: их целиком ведёт GPU (композитор), без работы основного потока
    // на каждый кадр. Скругление фото — постоянное (PhotoCard.css) и уменьшается вместе с ним.
    card.classList.add('is-zooming')
    const box = card.getBoundingClientRect()
    const rect = cell.getBoundingClientRect()
    const scale = rect.width / box.width
    const cx = rect.left - box.left + rect.width / 2
    const cy = rect.top - box.top + rect.height / 2
    // Фото в ячейке и сетка, увеличенная так, что ячейка закрывает карточку (transform-origin — левый верхний угол).
    const stageInCell = `translate(${cx - (box.width / 2) * scale}px, ${cy - (box.height / 2) * scale}px) scale(${scale})`
    const gridAtCell = `translate(${box.width / 2 - cx / scale}px, ${box.height / 2 - cy / scale}px) scale(${1 / scale})`
    const timing = { ...motionTiming(), fill: 'both' as const }
    const animations = view === 'grid'
      ? [
          stage.animate([{ transform: 'none', opacity: 1 }, { opacity: 0, offset: 0.5 }, { transform: stageInCell, opacity: 0 }], timing),
          grid.animate([{ transform: gridAtCell, opacity: 0 }, { opacity: 1, offset: 0.35 }, { transform: 'none', opacity: 1 }], timing),
        ]
      : [
          stage.animate([{ transform: stageInCell, opacity: 0 }, { opacity: 1, offset: 0.55 }, { transform: 'none', opacity: 1 }], timing),
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
  // (после «Далее» и «Сброса» бирка меняется на месте — только проявляется). Начинает не с прозрачного:
  // на тёмном фоне глубокое затемнение читалось как моргание, а на месте фото с первого кадра — миниатюра.
  const shownSlide = useRef({ id: item?.id ?? null, index: activeIndex })
  useLayoutEffect(() => {
    const previous = shownSlide.current
    shownSlide.current = { id: item?.id ?? null, index: activeIndex }
    const stage = stageRef.current
    if (!stage || view !== 'single' || settledView !== 'single' || previous.id === (item?.id ?? null) && previous.index === activeIndex) return
    if (prefersReducedMotion()) return
    const direction = Math.sign(activeIndex - previous.index)
    const animation = stage.animate(
      [{ transform: `translateX(${direction * 28}px)`, opacity: direction === 0 ? 0.6 : 0.5 }, { transform: 'none', opacity: 1 }],
      motionTiming(SLIDE_MS),
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
      // Улетает фото (у бирки без фото — её заглушка), кнопки масштаба и поворота над ним (если они там) гаснут.
      const photo = stage.querySelector<HTMLElement>('.photo-image-action, .photo-manual')
      return { fly: photo ? [photo] : [], hide: Array.from(stage.querySelectorAll<HTMLElement>('.photo-controls')) }
    },
  }), [])

  const isGridShown = view === 'grid' && settledView === 'grid'
  const classes = ['photo-card', hasPhoto && view === 'single' && 'has-photo', isZoomed && 'is-zoomed', isGridShown && 'is-grid-shown'].filter(Boolean).join(' ')

  return (
    <div ref={cardRef} className={classes} aria-busy={isBusy && view === 'single'} {...touchHandlers}>
      <div ref={stageRef} className={`photo-stage${isGridShown ? ' is-hidden' : ''}`} inert={view === 'grid' || undefined}>
        {photoUrl && !hasError && (
          <button
            ref={attachFrame}
            type="button"
            className="photo-image-action"
            aria-label={t('photo.open')}
            onPointerDownCapture={(event) => tapPhoto.onPress(photoUrl, event)}
            // Нажатие сразу после перетаскивания или щипка — не «тап»: не открываем и не увеличиваем.
            onClick={(event) => !wasGesture(event.timeStamp) && tapPhoto.onTap(photoUrl, event)}
            {...pointerHandlers}
          >
            {placeholder && (
              <img
                className={`photo-placeholder${transform.rotation % 180 !== 0 ? ' is-sideways' : ''}`}
                src={placeholder}
                alt=""
                draggable={false}
                // Повёрнута, как фото бирки: фото проявляется поверх неё в том же положении.
                style={{ rotate: `${transform.rotation}deg` }}
              />
            )}
            <PhotoFrame
              key={item?.id}
              url={photoUrl}
              alt={t('photo.alt')}
              transform={transform}
              onLoad={(size) => {
                const id = item?.id ?? null
                onLoad(size)
                window.setTimeout(() => {
                  if (itemIdRef.current === id) setLoadedId(id)
                }, PHOTO_FADE_MS)
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

        {/* Кнопки масштаба и поворота поверх фото (если они не в панели листания). */}
        {toolsOnPhoto && hasPhoto && !isBusy && <PhotoControls className="photo-controls anim-enter" transform={transform} showReset />}

        {/*
          Ячейка без снимка (пустая, «без фото» или ждущая фото): в правом верхнем углу — переключатель
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

        {/* Подсказка повернуть или переснять — сверху по центру фото (в слое фото: при переходе к сетке уходит с ним). */}
        {hint.mounted && hintReason && <RetakeHint reason={hintReason} isClosing={hint.closing} />}
      </div>

      {/*
        Сетка в DOM всегда (у одной бирки — прозрачна): переход к ней не ждёт её сборки и отрисовки — только анимацию.
      */}
      <PhotoGrid gridRef={gridRef} items={items} activeIndex={activeIndex} hidden={view === 'single' && settledView === 'single'} interactive={view === 'grid'} onSelect={onSelectCell} onOpen={onOpenCell} onToggleSelected={onToggleSelected} />
    </div>
  )
}
