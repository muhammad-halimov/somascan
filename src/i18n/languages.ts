/**
 * Языки интерфейса. Для каждого есть папка в `src/locales/`.
 */

/** Поддерживаемые коды языков. */
export const LANGUAGES = ['en', 'ro', 'tj', 'ru'] as const

/** Код языка интерфейса. */
export type Language = (typeof LANGUAGES)[number]

/** Язык при первом запуске — английский; русский, румынский и таджикский выбираются в настройках. */
export const DEFAULT_LANGUAGE: Language = 'en'

/** Язык, на который идёт откат, если строки нет в выбранном. */
export const FALLBACK_LANGUAGE: Language = 'en'

/** Проверка, что значение — поддерживаемый `Language`. */
export const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)

/**
 * Код языка из сохранённых настроек. В прежних версиях у таджикского был другой двухбуквенный код,
 * а других языков, кроме нынешних, не было: такой код — таджикский, выбор языка сохраняется.
 */
export function readLanguageCode(value: unknown): Language | undefined {
  if (isLanguage(value)) return value
  return typeof value === 'string' && /^[a-z]{2}$/.test(value) ? 'tj' : undefined
}

/** Язык в том виде, как он показан в выборе языка. */
export interface LanguageOption {
  /** Код языка. */
  code: Language
  /** Название на самом языке, чтобы пользователи узнавали его независимо от текущего языка интерфейса. */
  nativeName: string
  /** Эмодзи флага. */
  flag: string
}

/** Порядок в выборе: английский, румынский, таджикский, русский. */
export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { code: 'en', nativeName: 'English', flag: '🇬🇧' },
  { code: 'ro', nativeName: 'Română', flag: '🇷🇴' },
  { code: 'tj', nativeName: 'Тоҷикӣ', flag: '🇹🇯' },
  { code: 'ru', nativeName: 'Русский', flag: '🇷🇺' },
]
