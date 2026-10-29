import type { ComponentType } from 'react'
import type { Language } from '@/i18n/languages'
import { FlagGB, FlagRO, FlagRU, FlagTJ } from './Icons'

/** Флаг каждого языка интерфейса (английский — британский). */
const FLAGS: Readonly<Record<Language, ComponentType>> = { en: FlagGB, ro: FlagRO, tj: FlagTJ, ru: FlagRU }

/** Флаг языка: в выборе языка и у названий поля на разных языках. */
export function LanguageFlag({ language }: { language: Language }) {
  const Flag = FLAGS[language]
  return <Flag />
}
