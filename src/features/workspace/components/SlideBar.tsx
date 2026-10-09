import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRightIcon, GridIcon, ImageIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { motionTiming, prefersReducedMotion } from '../utils/motion'
import './SlideBar.css'

/**
 * Сколько панель держится в DOM, уходя (`usePresence`), мс: чуть дольше её анимации — та идёт столько же,
 * сколько переход между сеткой и одной биркой (до 420 мс), и кончается вместе с ним.
 */
export const SLIDE_BAR_EXIT_MS = 460

/** Свойства `SlideBar`. */
export interface SlideBarProps {
  /** Номер открытой бирки (последняя позиция — пустая ячейка, если бирок меньше девяти). */
  activeIndex: number
  /** Сколько позиций можно листать: бирки и (пока их меньше девяти) пустая ячейка за ними. */
  positions: number
  /** Сейчас на экране сетка: «Открыть» увеличивает выбранную ячейку до одной бирки; у одной бирки на её месте — «Сетка». */
  isGrid: boolean
  /** Предыдущая бирка. */
  onPrevious: () => void
  /** Следующая бирка (или пустая ячейка). */
  onNext: () => void
  /** Открыть выбранную бирку (из сетки). */
  onOpen: () => void
  /** Показать все бирки сеткой (у одной бирки). */
  onShowGrid: () => void
  /** Панель уходит: схлопывается по высоте и гаснет (см. `usePresence`). */
  isClosing?: boolean
}

/**
 * Панель листания — нижняя часть блока фото: листать бирки (уголки влево и вправо) и справа от них
 * переключатель вида: в сетке — «Открыть» (тот же значок фото, что и в углу сетки) увеличивает выбранную
 * ячейку до одной бирки, у одной бирки — «Сетка» показывает все; в сетке уголки передвигают выбор
 * по ячейкам, у одной бирки — листают бирки как слайды.
 * Кнопки компактные, без подписей (доступные имена — для экранных дикторов); на iOS 26+ — стеклянная
 * «пилюля» внутри блока.
 *
 * Появляется и уходит плавно: блок фото растёт и сжимается по высоте (с той же кривой и длительностью,
 * что и переход к сетке, — оба движения идут вместе), кнопки проявляются; карточка результата под блоком
 * съезжает вместе с ним, а не прыгает.
 */
export function SlideBar({ activeIndex, positions, isGrid, onPrevious, onNext, onOpen, onShowGrid, isClosing = false }: SlideBarProps) {
  const { t } = useTranslation('workspace')
  const barRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar || prefersReducedMotion()) return
    // Высота растёт от нуля вместе с отступами: без них панель сразу занимала свои 11 px и замирала
    // (а уходя — застревала на них и пропадала рывком).
    const { paddingTop, paddingBottom } = getComputedStyle(bar)
    const height = bar.getBoundingClientRect().height
    const frames: Keyframe[] = [
      { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 },
      { height: `${height}px`, paddingTop, paddingBottom, opacity: 1 },
    ]
    const pillFrames: Keyframe[] = [
      { transform: 'translateY(-8px) scale(.92)', opacity: 0 },
      { transform: 'none', opacity: 1 },
    ]
    // Та же кривая и длительность, что у перехода между сеткой и одной биркой: оба движения идут вместе.
    const timing = { ...motionTiming(), fill: 'both' as const }
    // Пока высота меняется, содержимое обрезается по панели (в покое тень «пилюли» не обрезаем).
    bar.classList.add('is-revealing')
    const animations = [
      bar.animate(isClosing ? [...frames].reverse() : frames, timing),
      bar.firstElementChild?.animate(isClosing ? [...pillFrames].reverse() : pillFrames, timing),
    ].filter((animation) => animation !== undefined)
    let cancelled = false
    void Promise.all(animations.map((animation) => animation.finished)).then(() => {
      if (cancelled || isClosing) return
      // Открылась: конечные кадры равны обычным стилям — анимации больше не нужны.
      animations.forEach((animation) => animation.cancel())
      bar.classList.remove('is-revealing')
    }, () => undefined)
    return () => {
      cancelled = true
      animations.forEach((animation) => animation.cancel())
      bar.classList.remove('is-revealing')
    }
  }, [isClosing])

  return (
    <div ref={barRef} className="slide-bar" role="group" aria-label={t('slides.group')} inert={isClosing || undefined}>
      <div className="slide-bar-pill">
        <ActionButton
          className="slide-bar-previous"
          size={32}
          icon={<ChevronRightIcon />}
          caption={t('slides.previous')}
          label={t('slides.previousLabel')}
          disabled={activeIndex <= 0}
          onClick={onPrevious}
        />
        <ActionButton
          size={32}
          icon={<ChevronRightIcon />}
          caption={t('slides.next')}
          label={t('slides.nextLabel')}
          disabled={activeIndex >= positions - 1}
          onClick={onNext}
        />
        {/* Переключатель вида: в сетке — «Открыть» выбранную бирку (фото), у одной бирки — «Сетка». */}
        {isGrid ? (
          <ActionButton key="open" className="slide-bar-toggle" size={32} variant="accent" icon={<ImageIcon />} caption={t('slides.open')} label={t('slides.openLabel')} onClick={onOpen} />
        ) : (
          <ActionButton key="grid" className="slide-bar-toggle" size={32} icon={<GridIcon />} caption={t('slides.grid')} label={t('slides.gridLabel')} onClick={onShowGrid} />
        )}
      </div>
    </div>
  )
}
