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
 * Панель между карточкой фото и карточкой результата: листать бирки (стрелки влево и вправо)
 * и «Открыть» — справа от стрелок, тот же значок фото, что и выход из сетки: в сетке стрелки
 * передвигают выбор по ячейкам, «Открыть» увеличивает выбранную до одной бирки; у одной бирки
 * стрелки листают её как слайды.
 */
export function SlideBar({ activeIndex, positions, isGrid, onPrevious, onNext, onOpen }: SlideBarProps) {
  const { t } = useTranslation('workspace')
  return (
    <div className="slide-bar" role="group" aria-label={t('slides.group')}>
      <ActionButton
        className="slide-bar-previous"
        size={44}
        icon={<ChevronRightIcon />}
        caption={t('slides.previous')}
        label={t('slides.previousLabel')}
        disabled={activeIndex <= 0}
        onClick={onPrevious}
      />
      <ActionButton
        size={44}
        icon={<ChevronRightIcon />}
        caption={t('slides.next')}
        label={t('slides.nextLabel')}
        disabled={activeIndex >= positions - 1}
        onClick={onNext}
      />
      <ActionButton
        size={44}
        variant={isGrid ? 'accent' : 'tonal'}
        icon={<ImageIcon />}
        caption={t('slides.open')}
        label={t('slides.openLabel')}
        active={!isGrid}
        disabled={!isGrid}
        onClick={onOpen}
      />
    </div>
  )
}
