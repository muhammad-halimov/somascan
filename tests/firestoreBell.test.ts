/**
 * «Звонок» Somasync через Firebase Firestore: SHA-256 без Web Crypto (как `node:crypto`), канал таблицы — тот же,
 * что считает Somasync, запрос `documents:commit` с ключом Web API, включение только с проектом и ключом,
 * настройки по умолчанию и разбор сохранённых.
 * Запуск: `npm test`.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { bellChannel, isBellConfigured, ringBell } from '../src/features/uploads/drive/firestoreBell'
import { providerRegistry } from '../src/features/recognition/providers/ProviderRegistry'
import { createDefaultSettings, parseSettings } from '../src/features/settings/store/settingsSchema'
import { sha256Hex } from '../src/lib/encoding/sha256'

test('SHA-256 совпадает с node:crypto: пусто, границы блока, длинный текст, не-ASCII', () => {
  for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1000), 'Şarjă плавка 🧲']) {
    assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'), JSON.stringify(text.slice(0, 10)))
  }
})

test('канал — SHA-256 от «id папки/имя таблицы»: то же значение проверяет Somasync (tests/phoneBridge.test.ts)', () => {
  assert.equal(bellChannel('1AbCdEfGhIjKlMnOpQ', 'Probe otel.xlsx'), '97516de6565212525e5d356587bd5800105ddb13cc714eebc4e1eb7dd1cb63be')
})

test('звонок: POST documents:commit, в документе канала только время звонка; ошибка Firestore — исключение', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response('{}', { status: calls.length === 1 ? 200 : 403 })
  }) as unknown as typeof fetch
  const bell = { enabled: true, projectId: ' somascan-test ', apiKey: ' AIzaKey ' }
  await ringBell(bell, 'root', 'Probe otel.xlsx', fetcher, Date.UTC(2026, 9, 30, 9))
  assert.equal(calls[0]!.url, 'https://firestore.googleapis.com/v1/projects/somascan-test/databases/(default)/documents:commit?key=AIzaKey')
  assert.equal(calls[0]!.init.method, 'POST')
  const { writes } = JSON.parse(String(calls[0]!.init.body)) as { writes: Array<{ update: { name: string; fields: Record<string, Record<string, string>> } }> }
  assert.equal(writes[0]!.update.name, `projects/somascan-test/databases/(default)/documents/somascan-bells/${bellChannel('root', 'Probe otel.xlsx')}`)
  assert.deepEqual(writes[0]!.update.fields, { at: { timestampValue: '2026-10-30T09:00:00.000Z' } })
  await assert.rejects(ringBell(bell, 'root', 'Probe otel.xlsx', fetcher), /403/)
})

test('настройки: по умолчанию выключено; включено — только с проектом и ключом; сохранённые разбираются', () => {
  const defaults = createDefaultSettings(providerRegistry)
  assert.deepEqual(defaults.storage.firestore, { enabled: false, projectId: '', apiKey: '' })
  assert.equal(isBellConfigured(defaults.storage.firestore), false)
  assert.equal(isBellConfigured({ enabled: true, projectId: 'p', apiKey: '' }), false)
  assert.equal(isBellConfigured({ enabled: true, projectId: 'p', apiKey: 'k' }), true)
  assert.equal(isBellConfigured(undefined), false)
  const parsed = parseSettings({ storage: { firestore: { enabled: true, projectId: ' p1 ', apiKey: 'k1', extra: 1 } } }, defaults)
  assert.deepEqual(parsed.storage.firestore, { enabled: true, projectId: 'p1', apiKey: 'k1' })
  assert.deepEqual(parseSettings({ storage: { firestore: 'мусор' } }, defaults).storage.firestore, defaults.storage.firestore)
})
