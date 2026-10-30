/**
 * Google Drive: клиент OAuth из файла, PKCE, вход через локальный адрес (поддельный сервер токенов), папка
 * из ссылки, локальная копия таблиц на поддельном Drive — скачивание только изменённого, блокировки как
 * у мобильного приложения, выгрузка с копией прежней версии, конфликт при изменении во время прогона.
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { FOLDER_MIME, XLSX_MIME, type DriveClient, type DriveFile } from '../src/host/drive/DriveClient'
import { DRIVE_ROOT, DriveMirror, LOCK_STALE_MS, parseDriveFolder } from '../src/host/drive/DriveMirror'
import { authUrl, parseClient, pkcePair, signIn } from '../src/host/drive/GoogleOAuth'
import { MessageError } from '../src/shared/messages'
import { DEFAULT_SETTINGS, parseSettings } from '../src/shared/settings'

const FOLDER = '1AbCdEfGhIjKlMnOpQ'

/** Поддельный Drive в памяти: папки, файлы с версиями, время создания. */
class FakeDrive {
  readonly files = new Map<string, DriveFile & { parent: string; bytes: Uint8Array }>()
  downloads = 0
  now = Date.UTC(2026, 9, 30, 10)
  private nextId = 1

  constructor() {
    this.put(FOLDER, DRIVE_ROOT, 'Tables', new Uint8Array(), FOLDER_MIME)
  }

  put(id: string, parent: string, name: string, bytes: Uint8Array, mimeType = XLSX_MIME, appProperties?: Record<string, string>, createdAt = this.now) {
    const md5Checksum = mimeType === FOLDER_MIME ? undefined : crypto.createHash('md5').update(bytes).digest('hex')
    const file = { id, parent, name, bytes, mimeType, md5Checksum, size: String(bytes.length), version: '1', createdTime: new Date(createdAt).toISOString(), modifiedTime: new Date(this.now).toISOString(), appProperties }
    this.files.set(id, file)
    return file
  }

  /** Меняет файл, как другое устройство: новая версия. */
  edit(id: string, bytes: Uint8Array) {
    const file = this.files.get(id)!
    Object.assign(file, { bytes, md5Checksum: crypto.createHash('md5').update(bytes).digest('hex'), version: String(Number(file.version) + 1) })
  }

  byName(name: string, parent = FOLDER) {
    return [...this.files.values()].filter((file) => file.parent === parent && file.name === name)
  }

  async get(id: string) { return this.files.get(id) ?? null }
  async find(parent: string, name: string, mimeType?: string) { return this.byName(name, parent).filter((file) => !mimeType || file.mimeType === mimeType) }
  async children(parent: string) { return [...this.files.values()].filter((file) => file.parent === parent) }
  async download(id: string) { this.downloads++; return this.files.get(id)!.bytes }
  async create(parent: string, name: string, bytes: Uint8Array, mimeType: string, appProperties?: Record<string, string>) { return this.put(`n${this.nextId++}`, parent, name, bytes, mimeType, appProperties) }
  async update(id: string, bytes: Uint8Array) { this.edit(id, bytes); return this.files.get(id)! }
  async copy(id: string, parent: string, name: string) { return this.put(`c${this.nextId++}`, parent, name, this.files.get(id)!.bytes) }
  async createFolder(parent: string, name: string) { return this.put(`f${this.nextId++}`, parent, name, new Uint8Array(), FOLDER_MIME) }
  async remove(id: string) { this.files.delete(id) }
}

/** Копия таблиц на поддельном Drive во временной папке. */
function setup(owner = 'somasync:pc') {
  const drive = new FakeDrive()
  drive.put('sarjele', FOLDER, 'Sarjele.xlsx', Buffer.from('S1'))
  drive.put('probe', FOLDER, 'Probe.xlsx', Buffer.from('P1'))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'somasync-drive-'))
  const mirror = new DriveMirror(root, async () => drive as unknown as DriveClient, owner, () => drive.now)
  const local = (name: string) => path.join(mirror.dir(FOLDER), name)
  return { drive, mirror, local }
}

test('клиент OAuth: файл Google Cloud Console («installed»), плоский вид; без id — нет', () => {
  assert.deepEqual(parseClient({ installed: { client_id: 'id.apps', client_secret: 's', redirect_uris: ['http://localhost'] } }), { clientId: 'id.apps', clientSecret: 's' })
  assert.deepEqual(parseClient({ client_id: 'id2' }), { clientId: 'id2', clientSecret: '' })
  assert.equal(parseClient({ installed: {} }), null)
  assert.equal(parseClient('мусор'), null)
})

test('PKCE: хеш секрета в адресе входа, доступ к Drive с refresh-токеном', () => {
  const { verifier, challenge } = pkcePair()
  assert.equal(challenge, crypto.createHash('sha256').update(verifier).digest('base64url'))
  const url = new URL(authUrl({ clientId: 'id', clientSecret: 's' }, 'http://127.0.0.1:5000', challenge, 'st'))
  assert.equal(url.searchParams.get('code_challenge'), challenge)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive')
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:5000')
})

test('вход: браузер возвращает код на 127.0.0.1, код меняется на токены с тем же секретом PKCE', async () => {
  let exchanged: URLSearchParams | null = null
  const fetcher = (async (_url: string, init: RequestInit) => {
    exchanged = new URLSearchParams(String(init.body))
    return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }), { status: 200 })
  }) as unknown as typeof fetch
  let page = ''
  const tokens = await signIn({ clientId: 'id', clientSecret: 's' }, (address) => {
    const url = new URL(address)
    // «браузер» после входа открывает адрес возврата с кодом
    void fetch(`${url.searchParams.get('redirect_uri')}/?code=c0de&state=${url.searchParams.get('state')}`).then(async (r) => { page = await r.text() })
  }, { done: 'Вход выполнен', failed: 'Не выполнен' }, fetcher)
  assert.equal(tokens.accessToken, 'at')
  assert.equal(tokens.refreshToken, 'rt')
  assert.equal(exchanged!.get('code'), 'c0de')
  assert.equal(exchanged!.get('grant_type'), 'authorization_code')
  assert.ok(exchanged!.get('code_verifier'))
  await new Promise((r) => setTimeout(r, 50))
  assert.match(page, /Вход выполнен/)
})

test('вход: чужой state — отказ', async () => {
  const fetcher = (async () => new Response('{}')) as unknown as typeof fetch
  await assert.rejects(signIn({ clientId: 'id', clientSecret: '' }, (address) => {
    const url = new URL(address)
    void fetch(`${url.searchParams.get('redirect_uri')}/?code=c0de&state=other`)
  }, { done: '', failed: '' }, fetcher), { name: 'OAuthError' })
})

test('папка: ссылка, id, пусто — «Мой диск»; неразборчивое — ошибка', () => {
  assert.equal(parseDriveFolder('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQ?usp=sharing'), FOLDER)
  assert.equal(parseDriveFolder('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQ'), FOLDER)
  assert.equal(parseDriveFolder(` ${FOLDER} `), FOLDER)
  assert.equal(parseDriveFolder(''), DRIVE_ROOT)
  assert.throws(() => parseDriveFolder('моя папка'), MessageError)
})

test('настройки: третье место хранения — Google Drive со своими именами таблиц', () => {
  assert.deepEqual(DEFAULT_SETTINGS.files.googleDrive, { consums: [''], sarjele: 'Sarjele din elemente.xlsx', probe: 'Probe otel.xlsx' })
  const s = parseSettings({ target: 'googleDrive', googleDrive: { account: 'a@b.ro', folder: FOLDER, token: 'enc:x' }, files: { local: { sarjele: '/s.xlsx' } } })
  assert.equal(s.target, 'googleDrive')
  assert.deepEqual(s.googleDrive, { account: 'a@b.ro', folder: FOLDER, token: 'enc:x' })
  assert.equal(s.files.googleDrive.probe, 'Probe otel.xlsx', 'старые настройки без набора Drive — имена по умолчанию')
  assert.equal(s.locked.folder, false)
})

test('копия: скачивается только изменённое; имена → пути копии', async () => {
  const { drive, mirror, local } = setup()
  assert.deepEqual(await mirror.pull(FOLDER, ['Sarjele.xlsx', 'Probe.xlsx', 'Consum.xlsx']), ['Consum.xlsx'])
  assert.equal(fs.readFileSync(local('Probe.xlsx'), 'utf8'), 'P1')
  assert.equal(drive.downloads, 2)
  await mirror.pull(FOLDER, ['Sarjele.xlsx', 'Probe.xlsx'])
  assert.equal(drive.downloads, 2, 'версии те же — не скачивается')
  drive.edit('probe', Buffer.from('P2'))
  await mirror.pull(FOLDER, ['Sarjele.xlsx', 'Probe.xlsx'])
  assert.equal(drive.downloads, 3)
  assert.equal(fs.readFileSync(local('Probe.xlsx'), 'utf8'), 'P2')
  assert.deepEqual(mirror.resolve(FOLDER, { consums: ['C.xlsx', ''], sarjele: 'Sarjele.xlsx', probe: '' }), { consums: [local('C.xlsx'), ''], sarjele: local('Sarjele.xlsx'), probe: '' })
})

test('выгрузка: изменённое движком — с копией прежней версии в backups; не изменённое не трогается', async () => {
  const { drive, mirror, local } = setup()
  await mirror.pull(FOLDER, ['Sarjele.xlsx', 'Probe.xlsx'])
  fs.writeFileSync(local('Sarjele.xlsx'), 'S2')
  const r = await mirror.push(FOLDER, ['Sarjele.xlsx', 'Probe.xlsx'], '2026-10-30T10-00-00-000Z', 30)
  assert.deepEqual(r, { uploaded: ['Sarjele.xlsx'], conflicts: [] })
  assert.equal(Buffer.from(drive.files.get('sarjele')!.bytes).toString(), 'S2')
  const [backups] = drive.byName('backups')
  assert.deepEqual(drive.byName('2026-10-30T10-00-00-000Z_Sarjele.xlsx', backups!.id).map((f) => Buffer.from(f.bytes).toString()), ['S1'])
  assert.equal(drive.files.get('probe')!.version, '1')
  // следующий прогон не скачивает своё же
  const before = drive.downloads
  await mirror.pull(FOLDER, ['Sarjele.xlsx'])
  assert.equal(drive.downloads, before)
})

test('выгрузка: таблицу изменили на Drive во время прогона — не затирается, следующий прогон скачает новую', async () => {
  const { drive, mirror, local } = setup()
  await mirror.pull(FOLDER, ['Probe.xlsx'])
  fs.writeFileSync(local('Probe.xlsx'), 'P-engine')
  drive.edit('probe', Buffer.from('P-phone'))
  assert.deepEqual(await mirror.push(FOLDER, ['Probe.xlsx'], 's', 30), { uploaded: [], conflicts: ['Probe.xlsx'] })
  assert.equal(Buffer.from(drive.files.get('probe')!.bytes).toString(), 'P-phone')
  await mirror.pull(FOLDER, ['Probe.xlsx'])
  assert.equal(fs.readFileSync(local('Probe.xlsx'), 'utf8'), 'P-phone')
})

test('копии в backups старше срока удаляются', async () => {
  const { drive, mirror, local } = setup()
  const folder = drive.put('bk', FOLDER, 'backups', new Uint8Array(), FOLDER_MIME)
  drive.put('old', folder.id, 'old_Sarjele.xlsx', Buffer.from('x'), XLSX_MIME, undefined, drive.now - 31 * 86_400_000)
  drive.put('fresh', folder.id, 'fresh_Sarjele.xlsx', Buffer.from('x'), XLSX_MIME, undefined, drive.now - 2 * 86_400_000)
  await mirror.pull(FOLDER, ['Sarjele.xlsx'])
  fs.writeFileSync(local('Sarjele.xlsx'), 'S2')
  await mirror.push(FOLDER, ['Sarjele.xlsx'], 'now', 30)
  assert.equal(drive.files.has('old'), false)
  assert.equal(drive.files.has('fresh'), true)
})

test('блокировка как у мобильного: чужая свежая — занято; брошенная и своя — снимаются; release убирает свои', async () => {
  const { drive, mirror } = setup()
  drive.put('phone', FOLDER, 'Probe.xlsx.lock', Buffer.from('phone'), 'text/plain', { somascanLockOwner: 'phone-1' })
  await assert.rejects(mirror.lock(FOLDER, ['Sarjele.xlsx', 'Probe.xlsx']), (e: MessageError) => e.msg.code === 'drive.busy' && e.msg.params?.owner === 'phone-1')
  assert.equal(drive.byName('Sarjele.xlsx.lock').length, 0, 'неудача — свои блокировки сняты')
  drive.now += LOCK_STALE_MS + 1000
  await mirror.lock(FOLDER, ['Sarjele.xlsx', 'Probe.xlsx'])
  assert.deepEqual(drive.byName('Probe.xlsx.lock').map((f) => f.appProperties?.somascanLockOwner), ['somasync:pc'])
  await mirror.release()
  assert.equal(drive.byName('Probe.xlsx.lock').length + drive.byName('Sarjele.xlsx.lock').length, 0)
  // своя блокировка от оборванного прогона
  drive.put('mine', FOLDER, 'Probe.xlsx.lock', Buffer.from(''), 'text/plain', { somascanLockOwner: 'somasync:pc' })
  await mirror.lock(FOLDER, ['Probe.xlsx'])
  assert.equal(drive.files.has('mine'), false)
  await mirror.release()
})

test('нет папки — понятная ошибка', async () => {
  const { mirror } = setup()
  await assert.rejects(mirror.pull('1ZzZzZzZzZzZzZzZz', ['Probe.xlsx']), (e: MessageError) => e.msg.code === 'drive.folderNotFound')
})
