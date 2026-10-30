/**
 * Google Drive как место хранения: вход и выход (вкладка «Хранилище»), подготовка прогона (скачать таблицы,
 * на время записи — заблокировать) и выгрузка записанного, проверка таблиц, слежение за Consum на Drive.
 *
 * Ключ доступа (refresh-токен) хранится в настройках зашифрованным, как пароль сетевого диска; access-токен —
 * только в памяти и обновляется сам за минуту до истечения. Отозванный доступ — сообщение «Войдите в Google снова».
 */
import os from 'node:os'
import path from 'node:path'
import { Backups } from '@/engine/FileGuard'
import { message, MessageError, type Message } from '@/shared/messages'
import type { ActionResult, CheckResult } from '@/shared/protocol'
import { activeFiles, type FileKind } from '@/shared/settings'
import type { AppPaths } from '../AppPaths'
import type { Journal } from '../Journal'
import type { SettingsStore } from '../SettingsStore'
import { DriveClient, DriveError } from './DriveClient'
import { DriveMirror } from './DriveMirror'
import { CLIENT_FILE, loadClient, OAuthError, refreshAccess, revoke, signIn, type OAuthClient } from './GoogleOAuth'

/** Запас до истечения access-токена, мс. */
const TOKEN_MARGIN_MS = 60_000

/** Подготовка прогона не удалась: причина и стоит ли повторить позже (таблицу пишет другое устройство). */
export interface RemoteProblem {
  msg: Message
  retry: boolean
}

/** Ошибка Drive или входа → сообщение для журнала и окна. */
export function driveMessage(error: unknown): Message {
  if (error instanceof MessageError) return error.msg
  if (error instanceof OAuthError) {
    if (error.code === 'notConfigured') return message('drive.notConfigured', { file: CLIENT_FILE })
    if (error.code === 'authRequired') return message('drive.authRequired')
    if (error.code === 'network') return message('drive.network', { error: error.message })
    return message('drive.error', { error: error.message })
  }
  if (error instanceof DriveError) {
    if (error.code === 'authRequired') return message('drive.authRequired')
    if (error.code === 'network') return message('drive.network', { error: error.message })
    if (error.code === 'accessDenied') return message('drive.accessDenied', { error: error.message })
    if (error.code === 'busy') return message('drive.rateLimited', { error: error.message })
    return message('drive.error', { error: error.message })
  }
  return message('drive.error', { error: error instanceof Error ? error.message : String(error) })
}

/** Google Drive в главном процессе. */
export class DriveService {
  private readonly paths: AppPaths
  private readonly settings: SettingsStore
  private readonly journal: Journal
  /** Открывает адрес в браузере системы. */
  private readonly open: (url: string) => void
  readonly mirror: DriveMirror
  /** Access-токен в памяти. */
  private access: { token: string; expiresAt: number } | null = null
  /** Код последней ошибки слежения за Consum (пишется в журнал один раз). */
  private refreshError: string | null = null

  constructor(paths: AppPaths, settings: SettingsStore, journal: Journal, open: (url: string) => void) {
    this.paths = paths
    this.settings = settings
    this.journal = journal
    this.open = open
    this.mirror = new DriveMirror(path.join(paths.data, 'drive'), () => this.client(), `somasync:${os.hostname()}`)
  }

  /** Место хранения — Google Drive. */
  active(): boolean {
    return this.settings.getSnapshot().target === 'googleDrive'
  }

  /** Клиент OAuth или ошибка «не настроено». */
  private oauthClient(): OAuthClient {
    const client = loadClient(this.paths.data)
    if (!client) throw new OAuthError('notConfigured')
    return client
  }

  /** Клиент Drive с действующим токеном. */
  async client(): Promise<DriveClient> {
    if (this.access && this.access.expiresAt - TOKEN_MARGIN_MS > Date.now()) return new DriveClient(this.access.token)
    const refreshToken = this.settings.driveToken()
    if (!this.settings.getSnapshot().googleDrive.account || !refreshToken) throw new MessageError(message('drive.signedOut'))
    try {
      const tokens = await refreshAccess(this.oauthClient(), refreshToken)
      this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt }
      return new DriveClient(tokens.accessToken)
    } catch (error) {
      if (error instanceof OAuthError && error.code === 'authRequired') this.access = null
      throw error
    }
  }

  /** Вход в браузере системы: почта аккаунта и ключ доступа — в настройки. */
  async signIn(): Promise<ActionResult> {
    try {
      const client = this.oauthClient()
      const pages = { done: this.settings.text(message('drive.pageDone')), failed: this.settings.text(message('drive.pageFailed')) }
      const tokens = await signIn(client, this.open, pages)
      if (!tokens.refreshToken) throw new OAuthError('failed', 'no refresh token')
      this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt }
      const account = (await new DriveClient(tokens.accessToken).userEmail()) || this.settings.text(message('drive.accountUnknown'))
      this.settings.setDriveAccount(account, tokens.refreshToken)
      this.journal.event('ok', message('drive.signedIn', { account }))
      return { ok: true }
    } catch (error) {
      const msg = driveMessage(error)
      if (!(error instanceof OAuthError && error.code === 'cancelled')) this.journal.event('err', message('drive.signInFailed', { error: msg }))
      return { ok: false, error: msg }
    }
  }

  /** Выход: доступ отзывается, папка и имена таблиц остаются. */
  async signOut(): Promise<void> {
    const token = this.settings.driveToken()
    const account = this.settings.getSnapshot().googleDrive.account
    this.access = null
    this.settings.setDriveAccount('', '')
    if (token) await revoke(token)
    if (account) this.journal.event('info', message('drive.signedOutEvent', { account }))
  }

  /** Имена таблиц текущего набора (без пустых). */
  private names(kinds: readonly FileKind[] = ['consum', 'sarjele', 'probe']): string[] {
    const set = activeFiles(this.settings.getSnapshot())
    const names = kinds.flatMap((kind) => (kind === 'consum' ? set.consums : [set[kind]]))
    return [...new Set(names.map((name) => path.basename(name.trim())).filter(Boolean))]
  }

  /** Папка таблиц (поле «Папка»). */
  private folder(): string {
    return this.settings.getSnapshot().googleDrive.folder
  }

  /**
   * Перед прогоном: с записью — блокировки таблиц, затем скачивание изменившихся.
   * @returns Причина, по которой прогон невозможен, или `null`.
   */
  async prepare(apply: boolean): Promise<RemoteProblem | null> {
    try {
      const names = this.names()
      if (apply) await this.mirror.lock(this.folder(), names)
      const missing = await this.mirror.pull(this.folder(), names)
      if (missing.length) {
        await this.mirror.release()
        return { msg: message('drive.notFound', { files: missing.join(', ') }), retry: false }
      }
      return null
    } catch (error) {
      await this.mirror.release()
      const msg = driveMessage(error)
      return { msg, retry: msg.code === 'drive.busy' || msg.code === 'drive.network' || msg.code === 'drive.rateLimited' }
    }
  }

  /** После прогона с записью: выгрузка изменённого; конфликты и ошибки — в журнал. */
  async finish(apply: boolean): Promise<void> {
    if (!apply) return
    try {
      const s = this.settings.getSnapshot()
      const { uploaded, conflicts } = await this.mirror.push(this.folder(), this.names(), Backups.stamp(), s.backupDays)
      if (uploaded.length) this.journal.event('ok', message('drive.uploaded', { files: uploaded.join(', ') }))
      for (const file of conflicts) this.journal.event('warn', message('drive.conflict', { file }))
    } catch (error) {
      this.journal.event('err', message('drive.uploadFailed', { error: driveMessage(error) }))
    }
  }

  /** Снимает блокировки. */
  release(): Promise<void> {
    return this.mirror.release()
  }

  /**
   * Скачивает Consum, изменившиеся на Drive (слежение: локальная копия меняется — прогон по ней).
   * Нет связи — следующая проверка попробует снова; другая ошибка пишется в журнал один раз, пока не пройдёт.
   */
  async refreshConsums(): Promise<void> {
    try {
      await this.mirror.pull(this.folder(), this.names(['consum']))
      this.refreshError = null
    } catch (error) {
      if (error instanceof DriveError && error.code === 'network') return
      const msg = driveMessage(error)
      if (msg.code !== this.refreshError) this.journal.event('warn', msg)
      this.refreshError = msg.code
    }
  }

  /**
   * Проверка таблицы на вкладке «Хранилище»: есть ли в папке, а листы — по скачанной копии той же проверкой,
   * что у файлов на компьютере (`checkLocal`).
   */
  async check(kind: FileKind, name: string, checkLocal: (kind: FileKind, file: string) => Promise<CheckResult>): Promise<CheckResult> {
    const clean = path.basename(name.trim())
    if (!clean) return { ok: false, msg: message('check.noPath') }
    try {
      const remote = await this.mirror.remoteFile(this.folder(), clean)
      if (!remote) return { ok: false, msg: message('check.notFound') }
      await this.mirror.pull(this.folder(), [clean])
      const result = await checkLocal(kind, path.join(this.mirror.dir(this.folder()), clean))
      // дата — изменения на Drive, а не скачивания
      const changed = remote.modifiedTime ? Date.parse(remote.modifiedTime) : null
      return result.ok && changed && result.msg.params ? { ...result, msg: { ...result.msg, params: { ...result.msg.params, date: changed } } } : result
    } catch (error) {
      return { ok: false, msg: driveMessage(error) }
    }
  }
}
