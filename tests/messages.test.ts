/**
 * Сообщения и переводы: подстановка параметров, одинаковые ключи и параметры во всех языках, итог прогона.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resources } from '../src/locales'
import { formatMessage, formatRu, message, MESSAGES } from '../src/shared/messages'
import { emptySummary, ENGINE_EXIT, runOutcome } from '../src/shared/protocol'
import { LANGUAGES } from '../src/shared/settings'

/** Все строки словаря: путь → текст. */
function flatten(node: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(key, v)
    else for (const [kk, vv] of flatten(v, key)) out.set(kk, vv)
  }
  return out
}

/** Параметры шаблона. */
const params = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',')

test('у всех языков те же ключи и те же параметры, что у русского', () => {
  for (const ns of Object.keys(resources.ru) as Array<keyof typeof resources.ru>) {
    const ru = flatten(resources.ru[ns])
    for (const lang of LANGUAGES) {
      const other = flatten(resources[lang][ns])
      assert.deepEqual([...other.keys()].sort(), [...ru.keys()].sort(), `${lang}/${ns}: ключи`)
      for (const [key, text] of ru) assert.equal(params(other.get(key)!), params(text), `${lang}/${ns}: параметры ${key}`)
    }
  }
})

test('параметры, вложенное сообщение, время', () => {
  const m = message('warn.deferredBusy', { reason: message('lock.busyHost', { file: 'S.xlsx', host: 'PC', time: Date.UTC(2026, 9, 19, 12, 5, 7) }) })
  assert.match(formatRu(m), /^Запись отложена: файл «S\.xlsx» сейчас записывает другой прогон \(PC, с \d{1,2}:05:07\)$/)
  assert.match(formatMessage(MESSAGES.en, m, 'en-GB'), /^Write postponed: file “S\.xlsx” is being written by another run \(PC, since/)
  assert.equal(formatRu(message('skip.badId', {})), 'странный ID «{{id}}» в колонке ID', 'нет параметра — шаблон остаётся')
})

test('итог прогона по коду выхода и данным', () => {
  const s = emptySummary('sync', true)
  assert.equal(runOutcome(s, ENGINE_EXIT.ok), 'nothing')
  assert.equal(runOutcome({ ...s, wrote: true }, ENGINE_EXIT.ok), 'wrote')
  assert.equal(runOutcome(s, ENGINE_EXIT.deferred), 'deferred')
  assert.equal(runOutcome(null, ENGINE_EXIT.error), 'failed')
  assert.equal(runOutcome({ ...emptySummary('sync', false), closed: ['H1'] }, ENGINE_EXIT.ok), 'planned')
})
