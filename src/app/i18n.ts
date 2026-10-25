/**
 * Переводы окна (i18next): английский (по умолчанию), румынский, таджикский, русский — `src/locales/<язык>/`.
 *
 * Ресурсы вшиты в бандл, поэтому инициализация синхронна и первый рендер уже на нужном языке.
 * Ключи `t()` проверяются по русским ресурсам: опечатка в ключе — ошибка компиляции.
 * Сообщения движка и главного процесса (`Message`) переводятся `useMessages` по словарю `messages`.
 */
import i18n from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import { NAMESPACES, resources, type Resources } from '@/locales'
import { formatMessage, type Message } from '@/shared/messages'
import { LOCALES, type Language } from '@/shared/settings'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: Resources
  }
}

/** Инициализирует i18next. Вызывается один раз, до первого рендера. */
export function initI18n(language: Language): void {
  void i18n.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    ns: NAMESPACES,
    defaultNS: 'common',
    // ресурсы вшиты в бандл: завершаем синхронно
    initAsync: false,
    // React уже экранирует выводимые строки
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  setLanguage(language)
}

/** Переключает язык интерфейса (если он другой). */
export function setLanguage(language: Language): void {
  if (i18n.language !== language) void i18n.changeLanguage(language)
  // таджикский в BCP 47 — `tg`
  document.documentElement.lang = language === 'tj' ? 'tg' : language
}

/** Текущий язык. */
const current = (): Language => (i18n.language in resources ? (i18n.language as Language) : 'en')

/** Форматы чисел и дат текущего языка. */
export function useLocale(): { locale: string; kg: (n: number) => string; time: (t: number) => string; dateTime: (t: number) => string } {
  useTranslation()
  const locale = LOCALES[current()]
  const num = new Intl.NumberFormat(locale)
  return {
    locale,
    kg: (n) => num.format(Math.round(n)),
    time: (t) => new Date(t).toLocaleTimeString(locale),
    dateTime: (t) => new Date(t).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }),
  }
}

/** Перевод сообщений (`Message`) на язык интерфейса; компонент перерисовывается при смене языка. */
export function useMessages(): (m: Message) => string {
  useTranslation()
  const lang = current()
  return (m) => formatMessage(resources[lang].messages, m, LOCALES[lang])
}
