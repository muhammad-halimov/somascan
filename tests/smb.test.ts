/**
 * Сетевой диск: команда `net use` (без запроса ввода в консоли) и понятные ошибки по номеру системной ошибки.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { StorageService } from '../src/host/StorageService'
import { DEFAULT_SETTINGS, type SmbSettings } from '../src/shared/settings'

const smb = (patch: Partial<SmbSettings>): SmbSettings => ({ ...DEFAULT_SETTINGS.smb, host: '10.0.0.5', share: 'Atelier', ...patch })

test('net use с учётной записью: пароль передаётся всегда — пустой тоже, иначе net ждал бы его ввода', () => {
  assert.deepEqual(StorageService.netUseArgs(smb({ domain: 'SOMACO', username: 'operator' }), 'secret'), ['use', '\\\\10.0.0.5\\Atelier', 'secret', '/user:SOMACO\\operator', '/persistent:no'])
  assert.deepEqual(StorageService.netUseArgs(smb({ username: 'operator' }), ''), ['use', '\\\\10.0.0.5\\Atelier', '', '/user:operator', '/persistent:no'])
})

test('net use без авторизации: без имени и пароля, даже если они заполнены', () => {
  assert.deepEqual(StorageService.netUseArgs(smb({ anonymous: true, username: 'operator' }), 'secret'), ['use', '\\\\10.0.0.5\\Atelier', '/persistent:no'])
  assert.deepEqual(StorageService.netUseArgs(smb({}), ''), ['use', '\\\\10.0.0.5\\Atelier', '/persistent:no'])
})

test('ошибки net use — по номеру, на любом языке Windows; 1219 — папка уже доступна', () => {
  assert.equal(StorageService.netUseError('System error 1219 has occurred.'), null)
  assert.deepEqual(StorageService.netUseError('Системная ошибка 53.\r\n\r\nНе найден сетевой путь.'), { code: 'smb.notFound' })
  assert.deepEqual(StorageService.netUseError('System error 1326 has occurred.'), { code: 'smb.badCredentials' })
  assert.deepEqual(StorageService.netUseError('Eroare de sistem 1223.'), { code: 'smb.needsAccount' })
  assert.deepEqual(StorageService.netUseError('System error 2242 has occurred.'), { code: 'smb.systemError', params: { code: 2242 } })
  assert.deepEqual(StorageService.netUseError('?'), { code: 'smb.failed' })
})
