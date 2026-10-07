import { useEffect } from 'react'
import { changeLanguage } from './i18n'
import type { Language } from './languages'

/** Применяет язык из настроек к i18next при каждом его изменении. */
export function useLanguageSync(language: Language) {
  useEffect(() => {
    changeLanguage(language)
  }, [language])
}
