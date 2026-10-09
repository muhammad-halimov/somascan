import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRightIcon, ImageIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { motionTiming, prefersReducedMotion } from '../utils/motion'
import './SlideBar.css'

/** Длительность исчезновения панели, мс (столько её держит в DOM `usePresence`). */
export const SLIDE_BAR_EXIT_MS = 300

/** Свойства `SlideBar`. */
export interface SlideBarProps {
  /** Номер открытой бирки (последняя позиция — пустая ячейка, если бирок меньше девяти). */
  activeIndex: number
  /** Сколько позиций можно листать: бирки и (пока их меньше девяти) пустая ячейка за ними. */
  positions: number
  /** Сейчас на экране сетка: «Открыть» увеличивает выбранную ячейку до одной бирки. */
  isGrid: boolean
  /** Предыдущая бирка. */
  onPrevious: () => void
  /** Следующая бирка (или пустая ячейка). */
  onNext: () => void
  /** Открыть выбранную бирку (из сетки). */
  onOpen: () => void
  /** Панель уходит: схлопывается по высоте и гаснет (см. `usePresence`). */
  isClosing?: boolean
}

/**
 * Панель листания — нижняя часть блока фото: листать бирки (уголки влево и вправо) и «Открыть» —
 * справа от них, тот же значок фото, что и в углу сетки: в сетке уголки передвигают выбор по ячейкам,
 * «Открыть» увеличивает выбранную до одной бирки; у одной бирки уголки листают бирки как слайды.
 * Кнопки компактные, без подписей (доступные имена — для экранных дикторов); на iOS 26+ — стеклянная
 * «пилюля» внутри блока.
 *
 * Появляется и уходит плавно: блок фото растёт и сжимается по высоте (с той же кривой и длительностью,
 * что и переход к сетке, — оба движения идут вместе), кнопки проявляются; карточка результата под блоком
 * съезжает вместе с ним, а не прыгает.
 */
export function SlideBar({ activeIndex, positions, isGrid, onPrevious, onNext, onOpen, isClosing = false }: SlideBarProps) {
  const { t } = useTranslation('workspace')
  const barRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar || prefersReducedMotion()) return
    const height = bar.scrollHeight
    const frames: Keyframe[] = [
      { height: '0px', opacity: 0 },
      { height: `${height}px`, opacity: 1 },
    ]
    const pillFrames: Keyframe[] = [
      { transform: 'translateY(-8px) scale(.92)', opacity: 0 },
      { transform: 'none', opacity: 1 },
    ]
    const timing = { ...motionTiming(isClosing ? SLIDE_BAR_EXIT_MS : undefined), fill: 'both' as const }
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
        <ActionButton
          size={32}
          variant={isGrid ? 'accent' : 'tonal'}
          icon={<ImageIcon />}
          caption={t('slides.open')}
          label={t('slides.openLabel')}
          active={!isGrid}
          disabled={!isGrid}
          onClick={onOpen}
        />
      </div>
    </div>
  )
}
