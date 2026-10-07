/**
 * Настройка i18next (react-i18next).
 *
 * Переводы вшиты в бандл (без загрузки по сети), поэтому инициализация синхронна,
 * а первый рендер уже локализован. Выбранный язык хранится в сторе настроек;
 * `useLanguageSync` синхронизирует с ним i18next и `<html lang>`.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { FALLBACK_LANGUAGE, type Language } from './languages'
import { DEFAULT_NAMESPACE, NAMESPACES, resources } from './resources'

/** Устанавливает `<html lang>`, чтобы скринридеры и переносы использовали нужный язык. */
function applyDocumentLanguage(language: Language) {
  document.documentElement.lang = language
}

/**
 * Инициализирует i18next. Вызывается один раз, до первого рендера.
 * @param language Язык, сохранённый в настройках.
 */
export function initI18n(language: Language) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: FALLBACK_LANGUAGE,
    ns: NAMESPACES,
    defaultNS: DEFAULT_NAMESPACE,
    // Ресурсы вшиты в бандл: завершаем синхронно.
    initAsync: false,
    // React уже экранирует выводимые строки.
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  applyDocumentLanguage(language)
}

/** Переключает язык интерфейса. */
export function changeLanguage(language: Language) {
  if (i18n.language !== language) void i18n.changeLanguage(language)
  applyDocumentLanguage(language)
}

export { i18n }
