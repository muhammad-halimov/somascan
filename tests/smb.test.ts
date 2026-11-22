/**
 * Сетевой диск: команда `net use` (без запроса ввода в консоли), понятные ошибки по номеру ошибки системы
 * (Windows и macOS), точка подключения в macOS, общая папка из путей таблиц, проверка сервера.
 */
import assert from 'node:assert/strict'
import net from 'node:net'
import { test } from 'node:test'
import { macMountError, mountPointOf, probeServer, serverAddress, shareOfPath, SmbShare } from '../src/host/SmbShare'
import { DEFAULT_SETTINGS, type SmbSettings } from '../src/shared/settings'

const smb = (patch: Partial<SmbSettings>): SmbSettings => ({ ...DEFAULT_SETTINGS.smb, host: '10.0.0.5', share: 'Atelier', ...patch })

test('net use с учётной записью: пароль передаётся всегда — пустой тоже, иначе net ждал бы его ввода', () => {
  assert.deepEqual(SmbShare.netUseArgs(smb({ domain: 'SOMACO', username: 'operator' }), 'secret'), ['use', '\\\\10.0.0.5\\Atelier', 'secret', '/user:SOMACO\\operator', '/persistent:no'])
  assert.deepEqual(SmbShare.netUseArgs(smb({ username: 'operator' }), ''), ['use', '\\\\10.0.0.5\\Atelier', '', '/user:operator', '/persistent:no'])
})

test('net use без авторизации: без имени и пароля, даже если они заполнены', () => {
  assert.deepEqual(SmbShare.netUseArgs(smb({ anonymous: true, username: 'operator' }), 'secret'), ['use', '\\\\10.0.0.5\\Atelier', '/persistent:no'])
  assert.deepEqual(SmbShare.netUseArgs(smb({}), ''), ['use', '\\\\10.0.0.5\\Atelier', '/persistent:no'])
})

test('net use без общей папки: вход на сервер (IPC$)', () => {
  assert.deepEqual(SmbShare.netUseArgs(smb({ share: '', username: 'operator' }), 'secret'), ['use', '\\\\10.0.0.5\\IPC$', 'secret', '/user:operator', '/persistent:no'])
})

test('ошибки net use — по номеру, на любом языке Windows; 1219 — папка уже доступна', () => {
  assert.equal(SmbShare.netUseError('System error 1219 has occurred.'), null)
  assert.deepEqual(SmbShare.netUseError('Системная ошибка 53.\r\n\r\nНе найден сетевой путь.'), { code: 'smb.notFound' })
  assert.deepEqual(SmbShare.netUseError('System error 1326 has occurred.'), { code: 'smb.badCredentials' })
  assert.deepEqual(SmbShare.netUseError('Eroare de sistem 1223.'), { code: 'smb.needsAccount' })
  assert.deepEqual(SmbShare.netUseError('System error 1272 has occurred.'), { code: 'smb.guestBlocked' })
  assert.deepEqual(SmbShare.netUseError('System error 2242 has occurred.'), { code: 'smb.passwordExpired' })
  assert.deepEqual(SmbShare.netUseError('System error 1231 has occurred.', '10.0.0.5'), { code: 'smb.serverDown', params: { host: '10.0.0.5' } })
  assert.deepEqual(SmbShare.netUseError('System error 4321 has occurred.'), { code: 'smb.systemError', params: { code: 4321 } })
  assert.deepEqual(SmbShare.netUseError('?'), { code: 'smb.failed' })
})

test('ошибки mount volume (macOS) — по коду в скобках, без «error of type»; -5063 — уже подключена', () => {
  const err = (code: number) => `7:42: execution error: An error of type ${code} has occurred. (${code})`
  assert.deepEqual(macMountError(err(-5014), '192.168.1.11:44508'), { code: 'smb.refused' })
  assert.deepEqual(macMountError(err(-5023), 'nas'), { code: 'smb.badCredentials' })
  assert.deepEqual(macMountError(err(-5016), 'nas'), { code: 'smb.serverDown', params: { host: 'nas' } })
  assert.deepEqual(macMountError('execution error: User canceled. (-128)', 'nas'), { code: 'smb.cancelled' })
  assert.equal(macMountError(err(-5063), 'nas'), null)
  assert.deepEqual(macMountError(err(-6600), 'nas'), { code: 'smb.macError', params: { code: -6600 } })
  assert.deepEqual(macMountError('что-то пошло не так', 'nas'), { code: 'smb.failed' })
})

test('точка подключения macOS — из вывода mount: сервер (с портом и без), папка, имя «-1»', () => {
  const out = [
    '/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)',
    '//GUEST:@192.168.1.11:4450/Downloads on /Volumes/Downloads (smbfs, nodev, nosuid, mounted by muhammad)',
    '//operator@NAS._smb._tcp.local/Atelier%20Docs on /Volumes/Atelier Docs-1 (smbfs, nodev, nosuid, mounted by muhammad)',
  ].join('\n')
  assert.equal(mountPointOf(out, '192.168.1.11:4450', 'Downloads'), '/Volumes/Downloads')
  assert.equal(mountPointOf(out, '192.168.1.11', 'downloads'), '/Volumes/Downloads')
  assert.equal(mountPointOf(out, '192.168.1.12', 'Downloads'), null)
  assert.equal(mountPointOf(out, 'nas', 'Atelier Docs'), '/Volumes/Atelier Docs-1')
  // без общей папки — первая папка этого сервера
  assert.equal(mountPointOf(out, 'nas.local', ''), '/Volumes/Atelier Docs-1')
  assert.equal(mountPointOf(out, 'nas', 'Other'), null)
})

test('общая папка из пути таблицы; адрес сервера с портом', () => {
  assert.equal(shareOfPath('\\\\10.0.0.5\\Atelier\\Consum otel.xlsx', true), 'Atelier')
  assert.equal(shareOfPath('/Volumes/Atelier/09/Consum otel.xlsx', false), 'Atelier')
  assert.equal(shareOfPath('/Users/operator/Documents/Consum otel.xlsx', false), '')
  assert.equal(shareOfPath('C:\\Tables\\Consum otel.xlsx', true), '')
  assert.deepEqual(serverAddress('192.168.1.11:4450'), { name: '192.168.1.11', port: 4450 })
  assert.deepEqual(serverAddress(' nas '), { name: 'nas', port: null })
  assert.deepEqual(serverAddress('[fe80::1]:445'), { name: 'fe80::1', port: 445 })
  assert.deepEqual(serverAddress('fe80::1'), { name: 'fe80::1', port: null })
})

test('проверка сервера: открытый порт — отвечает, закрытый — нет', async () => {
  const server = net.createServer((socket) => socket.end())
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  try {
    assert.equal(await probeServer(`127.0.0.1:${port}`), 'open')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
  assert.equal(await probeServer(`127.0.0.1:${port}`, 1000), 'closed')
})
