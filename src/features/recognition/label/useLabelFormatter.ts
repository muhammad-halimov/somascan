import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { LabelFormatter } from './LabelFormatter'

/** `LabelFormatter`, привязанный к текущему языку интерфейса. */
export function useLabelFormatter() {
  const { t } = useTranslation('label')
  return useMemo(() => new LabelFormatter({ notRecognized: t('notRecognized'), weightUnit: t('weightUnit'), lengthUnit: t('lengthUnit') }), [t])
}
