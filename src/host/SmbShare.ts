/**
 * Сетевой диск (SMB): подключение средствами системы, состояние подключения и понятные ошибки.
 *
 *   macOS   — `osascript … mount volume smb://…`: диск появляется в /Volumes (куда именно — из списка `mount`);
 *   Windows — `net use \\сервер\папка`: пути к таблицам — прямо `\\сервер\папка\…` (букву диска можно не назначать).
 *
 * Перед подключением — проверка, отвечает ли сервер (TCP 445 или 139, или порт из «сервер:порт»): выключенный сервер
 * или неверный адрес — сразу понятная ошибка, а не минута ожидания и код системы.
 * Общая папка необязательна: без неё берётся папка из путей таблиц (`\\сервер\папка\…`, `/Volumes/папка/…`),
 * а если путей ещё нет — Windows входит на сервер (`\\сервер\IPC$`), macOS предлагает выбрать папку своим окном.
 * Учётная запись нужна, когда папка требует входа; без авторизации — подключение без имени и пароля, под текущей
 * учётной записью системы.
 *
 * Ошибки — по номеру ошибки системы: текст системы — на её языке и в её кодировке (в окне читался бы искажённым),
 * а в командной строке — пароль. Неизвестный номер — общая фраза с номером для поддержки.
 *
 * Состояние (`status`) — без попытки подключить: подключён ли диск сейчас. От него зависит, доступны ли таблицы
 * на вкладке «Хранилище».
 */
import { execFile } from 'node:child_process'
import net from 'node:net'
import { message, type Message, type MessageCode } from '@/shared/messages'
import type { ShareResult } from '@/shared/protocol'
import { deskOf, MAC_VOLUMES, uncPath, type AppSettings, type SmbSettings } from '@/shared/settings'
import { exists, withTimeout } from './files'
import type { Journal } from './Journal'
import type { SettingsStore } from './SettingsStore'

/** Сколько ждать подключения диска, мс. */
const MOUNT_TIMEOUT_MS = 60_000

/** Сколько ждать ответа сервера при проверке, мс. */
const PROBE_TIMEOUT_MS = 4_000

/** Сколько ждать, откроется ли общая папка, мс: дольше — сетевой диск не отвечает. */
const OPEN_TIMEOUT_MS = 10_000

/** Порты SMB: прямой и через NetBIOS (старые серверы). */
const SMB_PORTS = [445, 139]

/** Системные ошибки Windows, которые `net use` сообщает чаще всего. */
const NET_ERROR = {
  accessDenied: 5,
  networkBusy: 51,
  pathNotFound: 53,
  nameDeleted: 64,
  nameNotFound: 67,
  badPassword: 86,
  semaphoreTimeout: 121,
  noProvider: 1203,
  alreadyConnected: 1219,
  cancelled: 1223,
  unreachable: 1231,
  guestBlocked: 1272,
  logonFailure: 1326,
  passwordExpired: 1330,
  accountDisabled: 1331,
  mustChange: 1907,
  accountLocked: 1909,
  passwordExpiredNet: 2242,
} as const

/** Понятное сообщение для системной ошибки `net use`. */
const NET_ERROR_MESSAGES: Partial<Record<number, MessageCode>> = {
  [NET_ERROR.accessDenied]: 'smb.accessDenied',
  [NET_ERROR.networkBusy]: 'smb.serverDown',
  [NET_ERROR.pathNotFound]: 'smb.notFound',
  [NET_ERROR.nameNotFound]: 'smb.notFound',
  [NET_ERROR.noProvider]: 'smb.notFound',
  [NET_ERROR.unreachable]: 'smb.serverDown',
  [NET_ERROR.nameDeleted]: 'smb.connectionLost',
  [NET_ERROR.semaphoreTimeout]: 'smb.connectionLost',
  [NET_ERROR.badPassword]: 'smb.badCredentials',
  [NET_ERROR.logonFailure]: 'smb.badCredentials',
  // ввода нет (`net` спросил имя и пароль): текущей учётной записи системы недостаточно
  [NET_ERROR.cancelled]: 'smb.needsAccount',
  [NET_ERROR.guestBlocked]: 'smb.guestBlocked',
  [NET_ERROR.accountLocked]: 'smb.accountLocked',
  [NET_ERROR.accountDisabled]: 'smb.accountLocked',
  [NET_ERROR.passwordExpired]: 'smb.passwordExpired',
  [NET_ERROR.mustChange]: 'smb.passwordExpired',
  [NET_ERROR.passwordExpiredNet]: 'smb.passwordExpired',
}

/** Ошибки `mount volume` в macOS (коды AppleScript и AFP/SMB). */
const MAC_ERROR = {
  cancelled: -128,
  timeout: -1712,
  ioError: -36,
  noVolume: -35,
  fileNotFound: -43,
  accessDenied: -5000,
  misc: -5014,
  noServer: -5016,
  objectNotFound: -5018,
  userNotAuth: -5023,
  dirNotFound: -5029,
  passwordExpired: -5042,
  passwordNeedsChange: -5045,
  alreadyMounted: -5063,
} as const

/** Понятное сообщение для ошибки `mount volume`. */
const MAC_ERROR_MESSAGES: Partial<Record<number, MessageCode>> = {
  [MAC_ERROR.cancelled]: 'smb.cancelled',
  [MAC_ERROR.timeout]: 'smb.timeout',
  [MAC_ERROR.ioError]: 'smb.connectionLost',
  [MAC_ERROR.noVolume]: 'smb.notFound',
  [MAC_ERROR.fileNotFound]: 'smb.notFound',
  [MAC_ERROR.objectNotFound]: 'smb.notFound',
  [MAC_ERROR.dirNotFound]: 'smb.notFound',
  [MAC_ERROR.accessDenied]: 'smb.accessDenied',
  // «прочая ошибка»: сервер не принял подключение (адрес, порт, имя папки)
  [MAC_ERROR.misc]: 'smb.refused',
  [MAC_ERROR.noServer]: 'smb.serverDown',
  [MAC_ERROR.userNotAuth]: 'smb.badCredentials',
  [MAC_ERROR.passwordExpired]: 'smb.passwordExpired',
  [MAC_ERROR.passwordNeedsChange]: 'smb.passwordExpired',
}

/** Сообщения с адресом сервера (`{{host}}`). */
const WITH_HOST = new Set<MessageCode>(['smb.serverDown'])

/** Сообщение об ошибке подключения: с адресом сервера, если он в тексте. */
const shareError = (code: MessageCode, host: string): Message => (WITH_HOST.has(code) ? message(code, { host }) : message(code))

/** Отвечает ли сервер: `open` — да, `closed` — нет (порт закрыт, нет ответа), `unknown` — не понять отсюда. */
export type ServerReach = 'open' | 'closed' | 'unknown'

/** Адрес сервера и порт из «сервер», «10.0.0.5:445», «[fe80::1]:445». */
export function serverAddress(host: string): { name: string; port: number | null } {
  const value = host.trim()
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(value)
  if (bracketed) return { name: bracketed[1]!, port: bracketed[2] ? Number(bracketed[2]) : null }
  const withPort = /^([^:]+):(\d+)$/.exec(value)
  return withPort ? { name: withPort[1]!, port: Number(withPort[2]) } : { name: value, port: null }
}

/** Отвечает ли порт `port` сервера `host` за `ms`. */
function probePort(host: string, port: number, ms: number): Promise<ServerReach> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (reach: ServerReach) => {
      socket.destroy()
      resolve(reach)
    }
    socket.setTimeout(ms, () => done('closed'))
    socket.once('connect', () => done('open'))
    // отказ — сервер есть, порт закрыт; прочее (имя не найдено, нет маршрута — в macOS так выглядит и запрет
    // «Локальной сети» для программы) не значит, что системе не подключиться: решит само подключение
    socket.once('error', (error: NodeJS.ErrnoException) => done(error.code === 'ECONNREFUSED' ? 'closed' : 'unknown'))
  })
}

/** Отвечает ли сервер SMB: хватит одного открытого порта. */
export async function probeServer(host: string, ms = PROBE_TIMEOUT_MS): Promise<ServerReach> {
  const { name, port } = serverAddress(host)
  if (!name) return 'unknown'
  const ports = port ? [port] : SMB_PORTS
  return new Promise((resolve) => {
    let left = ports.length
    let unknown = false
    for (const p of ports) {
      void probePort(name, p, ms).then((reach) => {
        if (reach === 'open') resolve('open')
        unknown ||= reach === 'unknown'
        if (--left === 0) resolve(unknown ? 'unknown' : 'closed')
      })
    }
  })
}

/** Общая папка из пути таблицы: `/Volumes/папка/…` в macOS, `\\сервер\папка\…` в Windows; иначе пусто. */
export function shareOfPath(file: string, windows: boolean): string {
  const m = windows ? /^\\\\[^\\]+\\([^\\]+)/.exec(file) : new RegExp(`^${MAC_VOLUMES}/([^/]+)/`).exec(file)
  return m?.[1] ?? ''
}

/** Имя сервера без порта и домена для сравнения: «Server.local:445» → «server». */
const hostKey = (host: string) => serverAddress(host).name.toLowerCase().split('.')[0]!
/** Адрес-IP сравнивается целиком. */
const sameHost = (a: string, b: string) => {
  const ip = /^[\d.]+$|:/
  const [x, y] = [serverAddress(a).name.toLowerCase(), serverAddress(b).name.toLowerCase()]
  return ip.test(x) || ip.test(y) ? x === y : hostKey(a) === hostKey(b)
}

/**
 * Куда macOS подключила общую папку — по выводу `mount`:
 * `//user@10.0.0.5:4450/Atelier on /Volumes/Atelier (smbfs, …)`. Без общей папки — первая папка этого сервера.
 * @returns Точка подключения или `null`, если не подключена.
 */
export function mountPointOf(mountOutput: string, host: string, share: string): string | null {
  for (const line of mountOutput.split(/\r?\n/)) {
    const m = /^\/\/(?:[^@/]*@)?([^/]+)\/(.+?) on (.+?) \(smbfs\b/.exec(line)
    if (!m || !sameHost(m[1]!, host)) continue
    const mounted = (() => {
      try {
        return decodeURIComponent(m[2]!)
      } catch {
        return m[2]!
      }
    })()
    if (!share || mounted.toLowerCase() === share.toLowerCase()) return m[3]!
  }
  return null
}

/**
 * Ошибка `mount volume` по коду в конце текста ошибки AppleScript («… (-5014)»): текст — на языке системы
 * и про «error of type», код — нет.
 * @returns `null`, если ошибки нет (-5063 — папка уже подключена).
 */
export function macMountError(stderr: string, host: string): Message | null {
  const code = Number(/\((-?\d+)\)\s*$/.exec(stderr.trim())?.[1] ?? NaN)
  if (code === MAC_ERROR.alreadyMounted) return null
  const known = MAC_ERROR_MESSAGES[code]
  if (known) return shareError(known, host)
  return Number.isFinite(code) ? message('smb.macError', { code }) : message('smb.failed')
}

/** Сетевой диск. */
export class SmbShare {
  private readonly settings: SettingsStore
  private readonly journal: Journal
  /** Куда подключён диск — по последней проверке или подключению (начальная папка выбора таблиц). */
  mountPoint: string | null = null

  constructor(settings: SettingsStore, journal: Journal) {
    this.settings = settings
    this.journal = journal
  }

  /**
   * Аргументы `net use`: с учётной записью пароль передаётся всегда (пустой — тоже), иначе `net` спросил бы его
   * в консоли и ждал ответа; без авторизации — без имени и пароля (под текущей учётной записью системы).
   * Без общей папки — вход на сервер (`\\сервер\IPC$`): папки на нём открываются потом при выборе таблиц.
   */
  static netUseArgs(smb: SmbSettings, password: string): string[] {
    const username = smb.anonymous ? '' : smb.username
    const account = username ? [password, `/user:${smb.domain ? `${smb.domain}\\` : ''}${username}`] : []
    const target = uncPath({ host: smb.host, share: smb.share || 'IPC$' })
    return ['use', target, ...account, '/persistent:no']
  }

  /**
   * Ошибка `net use` по номеру системной ошибки: текст `net` — на языке и в кодировке консоли Windows (в окне читался
   * бы искажённым), номер — нет. Неизвестный номер — общая фраза с номером.
   * @returns `null`, если ошибки нет (1219 — к серверу уже подключены: папка доступна).
   */
  static netUseError(output: string, host = ''): Message | null {
    const code = Number(output.match(/\b(\d{1,5})\b/)?.[1] ?? NaN)
    if (code === NET_ERROR.alreadyConnected) return null
    const known = NET_ERROR_MESSAGES[code]
    if (known) return shareError(known, host)
    return Number.isFinite(code) ? message('smb.systemError', { code }) : message('smb.failed')
  }

  /** Общая папка: из настроек, иначе — из путей таблиц текущего рабочего места на сетевом диске. */
  shareName(s: AppSettings = this.settings.getSnapshot()): string {
    if (s.smb.share) return s.smb.share
    const desk = deskOf(s.workplace)
    const set = s.files.smb
    const files = desk ? [s.desks[desk].files.smb] : [...set.consums, set.sarjele, set.probe]
    return files.map((f) => shareOfPath(f, process.platform === 'win32')).find(Boolean) ?? ''
  }

  /** Подключён ли диск сейчас (без попытки подключить). */
  async status(): Promise<ShareResult> {
    const s = this.settings.getSnapshot()
    if (!s.smb.host) return { ok: false, error: message('smb.noHost') }
    if ((await probeServer(s.smb.host)) === 'closed') return { ok: false, error: shareError('smb.serverDown', s.smb.host) }
    const mount = await this.mounted(s.smb.host, this.shareName(s))
    this.mountPoint = mount
    return mount ? { ok: true, mount } : { ok: false }
  }

  /**
   * Подключает общую папку и проверяет, что она открывается; итог — в журнал.
   * @returns Куда подключено (`mount`) или ошибка.
   */
  async mount(): Promise<ShareResult> {
    const result = await this.tryMount()
    this.mountPoint = result.ok ? (result.mount ?? null) : null
    if (result.ok) this.journal.event('ok', message('event.smbMounted', { mount: result.mount ?? '' }))
    else if (result.error) this.journal.event('err', message('event.smbFailed', { error: result.error }))
    return result
  }

  /** Подключение: проверки, сервер, система; подключилось, но папка не открывается — тоже ошибка. */
  private async tryMount(): Promise<ShareResult> {
    const s = this.settings.getSnapshot()
    const smb = { ...s.smb, share: this.shareName(s) }
    if (!smb.host) return { ok: false, error: message('smb.noHost') }
    // без авторизации учётная запись не передаётся, даже если заполнена; с авторизацией нужны имя и пароль
    const password = smb.anonymous ? '' : this.settings.smbPassword()
    if (!smb.anonymous && (!smb.username || !password)) return { ok: false, error: message('smb.noAccount') }
    if ((await probeServer(smb.host)) === 'closed') return { ok: false, error: shareError('smb.serverDown', smb.host) }
    const already = await this.mounted(smb.host, smb.share)
    if (already) return { ok: true, mount: already }
    const connected = await this.connect(smb, password)
    // без общей папки открывать нечего: вход на сервер (Windows) или папка, выбранная в окне macOS
    if (!connected.ok || !connected.mount || !smb.share) return connected
    const opens = await withTimeout(exists(connected.mount), OPEN_TIMEOUT_MS, () => false)
    return opens ? connected : { ok: false, error: message('smb.unreachable', { mount: connected.mount }) }
  }

  /** Куда подключена общая папка сервера (`share` пусто — любая его папка) или `null`. */
  private async mounted(host: string, share: string): Promise<string | null> {
    if (process.platform === 'darwin') {
      const point = mountPointOf(await run('/sbin/mount', []), host, share)
      return point && (await withTimeout(exists(point), OPEN_TIMEOUT_MS, () => false)) ? point : null
    }
    if (process.platform !== 'win32') return null
    if (share) {
      const unc = uncPath({ host, share })
      return (await withTimeout(exists(unc), OPEN_TIMEOUT_MS, () => false)) ? unc : null
    }
    // без общей папки — есть ли вход на сервер (`net use` перечисляет подключения; имя сервера — латиницей)
    const server = uncPath({ host, share: '' })
    return (await run('net', ['use'])).toLowerCase().includes(`${server.toLowerCase()}\\`) ? server : null
  }

  /** Подключение средствами системы: `net use` в Windows, `mount volume` в macOS. */
  private connect(smb: SmbSettings, password: string): Promise<ShareResult> {
    const { host, share, domain } = smb
    const username = smb.anonymous ? '' : smb.username
    if (process.platform === 'win32') {
      const mount = uncPath({ host, share })
      return new Promise((resolve) => {
        const child = execFile('net', SmbShare.netUseArgs(smb, password), { timeout: MOUNT_TIMEOUT_MS, windowsHide: true }, (err, out, stderr) => {
          // текст ошибки — только из вывода `net`: в `err.message` — вся команда, вместе с паролем
          if (err?.killed) return resolve({ ok: false, error: message('smb.timeout') })
          const error = err ? SmbShare.netUseError(`${stderr}\n${out}`, host) : null
          resolve(error ? { ok: false, error } : { ok: true, mount })
        })
        // `net` не должен ждать ввода с клавиатуры (имя, пароль): ввода нет — сразу ошибка вместо минуты ожидания
        child.stdin?.end()
      })
    }
    if (process.platform !== 'darwin') return Promise.resolve({ ok: false, error: message('smb.unsupported') })
    const credentials = username ? `${domain ? encodeURIComponent(domain) + ';' : ''}${encodeURIComponent(username)}${password ? ':' + encodeURIComponent(password) : ''}@` : ''
    const url = `smb://${credentials}${host}${share ? `/${encodeURIComponent(share)}` : ''}`
    return new Promise((resolve) =>
      execFile('osascript', ['-e', 'on run argv', '-e', 'mount volume (item 1 of argv)', '-e', 'end run', url], { timeout: MOUNT_TIMEOUT_MS }, (err, _out, stderr) => {
        // текст ошибки — только код из вывода: в `err.message` — адрес вместе с паролем
        const error = err ? (err.killed ? message('smb.timeout') : macMountError(String(stderr), host)) : null
        if (error) return resolve({ ok: false, error })
        // куда подключено — по списку `mount` (папка может получить имя «Atelier-1»)
        void run('/sbin/mount', []).then((list) => resolve({ ok: true, mount: mountPointOf(list, host, share) ?? (share ? `${MAC_VOLUMES}/${share}` : MAC_VOLUMES) }))
      }))
  }
}

/** Вывод команды (пусто при ошибке). */
function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: OPEN_TIMEOUT_MS, windowsHide: true }, (_err, out) => resolve(String(out ?? '')))
  })
}
