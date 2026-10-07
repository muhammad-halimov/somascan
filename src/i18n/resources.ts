/**
 * Ресурсы переводов всех языков.
 *
 * Эталон — английский: все остальные языки типизированы как `Resources`,
 * поэтому отсутствующий ключ ломает сборку TypeScript, а не всплывает в рантайме.
 */
import en from '@/locales/en'
import ro from '@/locales/ro'
import ru from '@/locales/ru'
import tg from '@/locales/tj'
import type { Language } from './languages'

/** Структура одного языка: пространство имён → вложенные ключи. */
export type Resources = typeof en

/** Пространства имён, по одному на фичу; каждое — JSON-файл в папке каждой локали. */
export const NAMESPACES = ['common', 'workspace', 'label', 'settings', 'uploads', 'errors'] as const satisfies readonly (keyof Resources)[]

/** Пространство имён по умолчанию для `t()` без префикса. */
export const DEFAULT_NAMESPACE = 'common' satisfies keyof Resources

/** Все языки, проверенные по типам относительно английского. */
export const resources: Record<Language, Resources> = { en, ro, tg, ru }
