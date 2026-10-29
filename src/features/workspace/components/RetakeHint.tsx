import { useTranslation } from 'react-i18next'
import { ExclamationIcon } from '@/components/icons/Icons'
import './RetakeHint.css'

/** Свойства `RetakeHint`. */
export interface RetakeHintProps {
  /** Проигрывается исчезновение. */
  isClosing?: boolean
}

/**
 * Подсказка поверх фото, между «Назад» и «Сеткой», когда бирка распознана не полностью: мягко предлагает
 * повернуть фото (и нажать «Повтор»); что фото плохое и его лучше переснять, объясняет окно качества.
 * Полупрозрачная, как подложка угловых кнопок, — фото видно сквозь неё; одна строка без переноса. Лежит в слое фото, поэтому при переходе к сетке уезжает и растворяется вместе с ним.
 */
export function RetakeHint({ isClosing = false }: RetakeHintProps) {
  const { t } = useTranslation('workspace')
  return (
    <div className="retake-hint-slot">
      <p className={`retake-hint${isClosing ? ' is-closing' : ''}`} role="status">
        <span className="retake-hint-icon" aria-hidden="true"><ExclamationIcon /></span>
        <span className="retake-hint-text">{t('retakeHint')}</span>
      </p>
    </div>
  )
}
