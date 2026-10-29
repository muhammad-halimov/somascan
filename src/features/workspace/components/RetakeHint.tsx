import { useTranslation } from 'react-i18next'
import { ExclamationIcon } from '@/components/icons/Icons'
import './RetakeHint.css'

/**
 * Подсказка над панелью листания, когда бирка распознана не полностью: повернуть фото (и нажать «Повтор»)
 * или переснять. Одна строка — без переноса.
 */
export function RetakeHint() {
  const { t } = useTranslation('workspace')
  return (
    <p className="retake-hint anim-fade" role="status">
      <span className="retake-hint-icon" aria-hidden="true"><ExclamationIcon /></span>
      <span className="retake-hint-text">{t('retakeHint')}</span>
    </p>
  )
}
