import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { RecognitionError } from './RecognitionError'

/**
 * Возвращает функцию, превращающую любое выброшенное значение в локализованное сообщение для пользователя.
 * Для `RecognitionError` используется их код; остальные ошибки отдают собственное сообщение.
 */
export function useErrorText() {
  const { t } = useTranslation('errors')
  return useCallback((error: unknown) => {
    if (error instanceof RecognitionError) {
      return t(`recognition.${error.code}`, { provider: '', detail: '', ...error.params })
    }
    return error instanceof Error ? error.message : String(error)
  }, [t])
}
