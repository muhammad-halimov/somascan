/**
 * Переводы окна: по папке на язык, по JSON-файлу на пространство имён (общее, вкладки, сообщения).
 *
 * Эталон — русский: остальные языки типизируются как `Resources`, поэтому пропущенный ключ ломает сборку,
 * а не всплывает в окне. Порядок языков — как в выборе языка (`LANGUAGES`).
 */
import type { Language } from '@/shared/settings'
import enCommon from './en/common.json'
import enRun from './en/run.json'
import enStorage from './en/storage.json'
import enLinks from './en/links.json'
import enSettings from './en/settings.json'
import enMessages from './en/messages.json'
import roCommon from './ro/common.json'
import roRun from './ro/run.json'
import roStorage from './ro/storage.json'
import roLinks from './ro/links.json'
import roSettings from './ro/settings.json'
import roMessages from './ro/messages.json'
import tjCommon from './tj/common.json'
import tjRun from './tj/run.json'
import tjStorage from './tj/storage.json'
import tjLinks from './tj/links.json'
import tjSettings from './tj/settings.json'
import tjMessages from './tj/messages.json'
import ruCommon from './ru/common.json'
import ruRun from './ru/run.json'
import ruStorage from './ru/storage.json'
import ruLinks from './ru/links.json'
import ruSettings from './ru/settings.json'
import ruMessages from './ru/messages.json'

/** Пространства имён. */
export const NAMESPACES = ['common', 'run', 'storage', 'links', 'settings', 'messages'] as const

/** Переводы одного языка. */
export type Resources = { common: typeof ruCommon; run: typeof ruRun; storage: typeof ruStorage; links: typeof ruLinks; settings: typeof ruSettings; messages: typeof ruMessages }

/** Переводы всех языков. */
export const resources: Record<Language, Resources> = {
  en: { common: enCommon, run: enRun, storage: enStorage, links: enLinks, settings: enSettings, messages: enMessages },
  ro: { common: roCommon, run: roRun, storage: roStorage, links: roLinks, settings: roSettings, messages: roMessages },
  tj: { common: tjCommon, run: tjRun, storage: tjStorage, links: tjLinks, settings: tjSettings, messages: tjMessages },
  ru: { common: ruCommon, run: ruRun, storage: ruStorage, links: ruLinks, settings: ruSettings, messages: ruMessages },
}
