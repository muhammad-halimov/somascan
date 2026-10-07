import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { isLanguage } from '@/i18n/languages'
import type { LabelFieldDefinition } from './labelFields'

/**
 * Название поля на текущем языке интерфейса: заданное пользователем, иначе (у встроенных полей)
 * перевод по умолчанию, иначе английское название, иначе ключ.
 */
export function useLabelFieldName() {
  const { t, i18n } = useTranslation('label')
  return useCallback((field: LabelFieldDefinition) => {
    const language = isLanguage(i18n.language) ? i18n.language : 'en'
    const own = field.names[language]?.trim()
    if (own) return own
    const english = field.names.en?.trim()
    if (field.builtIn) return t(`fields.${field.key}` as 'fields.contract', { defaultValue: english || field.key })
    return english || field.key
  }, [t, i18n.language])
}
