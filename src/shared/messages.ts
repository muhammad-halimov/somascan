/**
 * Сообщения для журнала и окна: код + параметры вместо готового текста.
 *
 * Движок и главный процесс пишут `Message`, а текст подставляется по языку окна из `locales/<язык>/messages.json`.
 * Технический журнал движка (`log.txt`, «Подробно») — по-русски: тем же словарём `ru`.
 *
 * Шаблон — `{{имя}}`. Параметр-сообщение подставляется своим текстом; число в параметре `time` — время, в `date` —
 * дата и время по языку.
 */
import en from '@/locales/en/messages.json'
import ro from '@/locales/ro/messages.json'
import ru from '@/locales/ru/messages.json'
import tj from '@/locales/tj/messages.json'
import type { JournalRun, RunTrigger } from './protocol'
import { LOCALES, type Language } from './settings'

/** Ключи словаря через точку: `skip.badId`. */
type Paths<T> = { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}` }[keyof T & string]

/** Код сообщения. */
export type MessageCode = Paths<typeof ru>

/** Значение параметра. */
export type MessageParam = string | number | Message

/** Сообщение. */
export interface Message {
  code: MessageCode
  params?: Record<string, MessageParam>
}

/** Словарь сообщений одного языка (как `messages.json`). */
export type MessageTemplates = typeof ru

/** Сообщение с кодом и параметрами. */
export const message = (code: MessageCode, params?: Record<string, MessageParam>): Message => (params ? { code, params } : { code })

/** Ошибка с сообщением для журнала (текст `Error.message` — по-русски). */
export class MessageError extends Error {
  readonly msg: Message
  constructor(msg: Message) {
    super(formatRu(msg))
    this.name = 'MessageError'
    this.msg = msg
  }
}

/** Шаблон по коду. */
function template(templates: MessageTemplates, code: string): string {
  let node: unknown = templates
  for (const part of code.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  return typeof node === 'string' ? node : code
}

/** Текст сообщения на языке словаря. `locale` — для дат и времени. */
export function formatMessage(templates: MessageTemplates, m: Message, locale = 'ru-RU'): string {
  const params = m.params ?? {}
  return template(templates, m.code).replace(/\{\{(\w+)\}\}/g, (all, name: string) => {
    const v = params[name]
    if (v === undefined) return all
    if (typeof v === 'object') return formatMessage(templates, v, locale)
    if (typeof v === 'number' && name === 'time') return new Date(v).toLocaleTimeString(locale)
    if (typeof v === 'number' && name === 'date') return new Date(v).toLocaleString(locale)
    return String(v)
  })
}

/** Словари всех языков. */
export const MESSAGES: Record<Language, MessageTemplates> = { en, ro, tj, ru }

/** Текст на языке интерфейса. */
export const formatIn = (lang: Language, m: Message): string => formatMessage(MESSAGES[lang], m, LOCALES[lang])

/** Текст по-русски (технический журнал). */
export const formatRu = (m: Message): string => formatMessage(ru, m, 'ru-RU')

/** Что запустило прогон. */
export const triggerMessage = (trigger: RunTrigger): Message => message(`trigger.${trigger}`)

/** Одна строка о прогоне: что запустило и чем кончилось (трей, копирование журнала). */
export const runHeadline = (run: Pick<JournalRun, 'trigger' | 'outcome'>): Message => message(`run.${run.outcome}`, { trigger: triggerMessage(run.trigger) })
