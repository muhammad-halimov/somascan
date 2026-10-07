import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { UploadError, type UploadErrorCode } from './UploadError'

/** Сбой, у которого есть код и, возможно, подробности (запись из стора или `UploadError`). */
export interface UploadFailureLike {
  /** Код ошибки. */
  code: UploadErrorCode
  /** Подробности. */
  detail?: string
}

/**
 * Возвращает функцию, превращающую сбой выгрузки в сообщение на языке интерфейса
 * (`errors:upload.<код>`); подробности и адреса подставляются в текст.
 */
export function useUploadErrorText() {
  const { t } = useTranslation('errors')
  return useCallback((failure: UploadFailureLike | UploadError) => {
    const params = failure instanceof UploadError ? failure.params : { detail: failure.detail }
    return t(`upload.${failure.code}`, { detail: '', host: '', share: '', path: '', owner: '', ...params })
  }, [t])
}
