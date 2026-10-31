import { useTranslation } from 'react-i18next'
import { InfoIcon } from '@/components/icons/Icons'
import type { RetakeHintReason } from '../utils/retakeHint'
import './RetakeHint.css'

/** Свойства `RetakeHint`. */
export interface RetakeHintProps {
  /** Что мешает распознать (`retakeHintReason`). */
  reason: RetakeHintReason
  /** Проигрывается исчезновение. */
  isClosing?: boolean
}

/**
 * Подсказка поверх фото, между «Назад» и «Сеткой», когда бирка распознана не полностью: что мешает и что сделать
 * («Поверните фото», «Снимите бирку ближе», «Фото размыто», иначе «Не все поля распознаны»); подробнее о плохом
 * фото — в окне качества.
 * Значок — «i», как у примечания «Проверьте данные». Полупрозрачная, как подложка угловых кнопок, — фото видно
 * сквозь неё; одна строка без переноса. Лежит в слое фото, поэтому при переходе к сетке уезжает и растворяется
 * вместе с ним.
 */
export function RetakeHint({ reason, isClosing = false }: RetakeHintProps) {
  const { t } = useTranslation('workspace')
  return (
    <div className="retake-hint-slot">
      <p className={`retake-hint${isClosing ? ' is-closing' : ''}`} role="status">
        <InfoIcon />
        <span className="retake-hint-text">{t(`retakeHints.${reason}`)}</span>
      </p>
    </div>
  )
}
