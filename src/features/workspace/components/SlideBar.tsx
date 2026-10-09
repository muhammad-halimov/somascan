import { useTranslation } from 'react-i18next'
import { ChevronRightIcon, ImageIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import './SlideBar.css'

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
}

/**
 * Панель листания — нижняя часть блока фото: листать бирки (уголки влево и вправо) и «Открыть» —
 * справа от них, тот же значок фото, что и в углу сетки: в сетке уголки передвигают выбор по ячейкам,
 * «Открыть» увеличивает выбранную до одной бирки; у одной бирки уголки листают бирки как слайды.
 * Кнопки компактные, без подписей (доступные имена — для экранных дикторов); на iOS 26+ — стеклянная
 * «пилюля» внутри блока.
 */
export function SlideBar({ activeIndex, positions, isGrid, onPrevious, onNext, onOpen }: SlideBarProps) {
  const { t } = useTranslation('workspace')
  return (
    <div className="slide-bar" role="group" aria-label={t('slides.group')}>
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
