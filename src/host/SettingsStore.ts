/**
 * Настройки программы в главном процессе: `userData/state.json`.
 *
 * Запись — через временный файл и переименование, чтобы сбой посреди записи не испортил файл.
 * Окно получает копию с маской вместо пароля (`publicSettings`); изменения из окна приходят патчем (`apply`).
 * Флаг `running` (воля пользователя «слежение включено») меняют только «Старт» и «Стоп».
 *
 * Пароль сетевого диска и ключ доступа к Google Drive на диске — только зашифрованными системным хранилищем
 * (Keychain / DPAPI через `safeStorage`). Если шифрование недоступно, они хранятся в base64 с пометкой `raw:`
 * (это не защита); когда шифрование снова доступно, такие значения при запуске шифруются. Ключ Google в окно
 * не отдаётся вовсе, а почту аккаунта и ключ меняет только вход и выход.
 *
 * Расшифровываются они один раз — при запуске (`load`), и дальше берутся из памяти: если macOS спросит доступ
 * к связке ключей, то сразу при запуске, а не посреди слежения. Не расшифровалось (доступ не разрешили, программу
 * переподписали другим ключом) — об этом сообщается в журнал, окно показывает пустой пароль и «Войти через Google»,
 * а зашифрованное значение остаётся в файле: после разрешения доступа при следующем запуске всё прочитается.
 * Постоянную подпись на macOS даёт `install-macos.command`: с ней доступ разрешается один раз, а не после каждой установки.
 * РИСК: без системного шифрования (`raw:`) пароль и ключ читаются любым, у кого есть доступ к `state.json`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import { Store } from '@/shared/Store'
import { formatIn, type Message } from '@/shared/messages'
import { activeFiles, DEFAULT_SETTINGS, mergeSettings, parseSettings, PASSWORD_MASK, type AppSettings, type FileSet, type SettingsPatch } from '@/shared/settings'

/** Что не удалось расшифровать: пароль сетевого диска или ключ Google. */
export type SecretKind = 'smb' | 'drive'

/** Хранилище настроек. */
export class SettingsStore extends Store<AppSettings> {
  /** Файл настроек. */
  private readonly file: string
  /** Куда сообщать об ошибке записи. */
  private readonly onError: (error: string) => void
  /** Куда сообщать, что пароль или ключ не расшифровался. */
  private readonly onSecretLost: (kind: SecretKind) => void
  /** Расшифрованные значения: сохранённое (`enc:…`, `raw:…`) → текст; `null` — не расшифровалось. */
  private readonly plain = new Map<string, string | null>()
  /** Идёт чтение с диска — сохранять нечего. */
  private loading = false
  /** Имена таблиц Google Drive → пути их локальной копии (задаёт `HostServices`, см. `DriveMirror`). */
  resolveDrive: (folder: string, names: FileSet) => FileSet = (_folder, names) => names

  /**
   * @param file `state.json`.
   * @param onError Ошибка записи (в журнал).
   * @param onSecretLost Пароль или ключ не расшифровался (в журнал).
   */
  constructor(file: string, onError: (error: string) => void, onSecretLost: (kind: SecretKind) => void = () => {}) {
    super(DEFAULT_SETTINGS)
    this.file = file
    this.onError = onError
    this.onSecretLost = onSecretLost
  }

  /** Читает настройки с диска (нет файла или он испорчен — значения по умолчанию). */
  load(): void {
    let raw: unknown = {}
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      // первый запуск
    }
    this.loading = true
    try {
      this.setState(parseSettings(raw))
    } finally {
      this.loading = false
    }
    this.unlockSecrets()
  }

  /**
   * Расшифровывает пароль и ключ сразу после чтения: не расшифровалось — сообщение в журнал; хранятся без шифрования
   * (`raw:`), а оно уже доступно — шифруются.
   */
  private unlockSecrets(): void {
    const { smb, googleDrive } = this.getSnapshot()
    const secrets = [['smb', smb.password], ['drive', googleDrive.token]] as const
    for (const [kind, stored] of secrets) if (stored && this.decode(stored) === null) this.onSecretLost(kind)
    if (!secrets.some(([, stored]) => stored.startsWith('raw:')) || !SettingsStore.encryptionAvailable()) return
    const reseal = (stored: string) => (stored.startsWith('raw:') ? this.encode(this.decode(stored) ?? '') : stored)
    this.update({ smb: { password: reseal(smb.password) }, googleDrive: { token: reseal(googleDrive.token) } })
  }

  /** Текст сообщения на языке интерфейса (трей, диалоги). */
  text(m: Message): string {
    return formatIn(this.getSnapshot().language, m)
  }

  /**
   * Настройки для окна: пароль заменён маской, ключа Google нет. Нерасшифрованный пароль — пустой (его нужно ввести
   * заново), нерасшифрованный ключ Google — аккаунта нет («Войти через Google»).
   */
  publicSettings(): AppSettings {
    const s = this.getSnapshot()
    const password = s.smb.password && this.decode(s.smb.password) ? PASSWORD_MASK : ''
    const account = s.googleDrive.token && !this.decode(s.googleDrive.token) ? '' : s.googleDrive.account
    return { ...s, smb: { ...s.smb, password }, googleDrive: { ...s.googleDrive, account, token: '' } }
  }

  /** Файлы текущего места хранения; у Google Drive — пути локальной копии таблиц. */
  files(): FileSet {
    const s = this.getSnapshot()
    return s.target === 'googleDrive' ? this.resolveDrive(s.googleDrive.folder, activeFiles(s)) : activeFiles(s)
  }

  /** Файлы Consum текущего места хранения (без пустых строк). */
  consumFiles(): string[] {
    return this.files().consums.map((c) => c.trim()).filter(Boolean)
  }

  /** Расшифрованный пароль сетевого диска (не удалось — пусто: пароль придётся ввести заново). */
  smbPassword(): string {
    return this.decode(this.getSnapshot().smb.password) ?? ''
  }

  /** Расшифрованный ключ доступа к Google Drive (refresh-токен); пусто — нужен вход. */
  driveToken(): string {
    return this.decode(this.getSnapshot().googleDrive.token) ?? ''
  }

  /** Вход или выход Google: почта аккаунта и ключ доступа (пустые — выход). */
  setDriveAccount(account: string, token: string): void {
    this.update({ googleDrive: { account, token: this.encode(token) } })
  }

  /**
   * Применяет изменение из окна. Маска пароля означает «не менять», `running` из окна игнорируется.
   * @returns Изменённые ключи.
   */
  apply(patch: SettingsPatch): Array<keyof AppSettings> {
    const { running: _running, ...safe } = patch
    // аккаунт и ключ Google меняют только вход и выход, из окна — только папка
    if (safe.googleDrive) safe.googleDrive = 'folder' in safe.googleDrive ? { folder: safe.googleDrive.folder } : {}
    if (safe.smb && 'password' in safe.smb) {
      const p = safe.smb.password ?? ''
      safe.smb = { ...safe.smb, password: p === PASSWORD_MASK ? this.getSnapshot().smb.password : this.encode(p) }
    }
    this.update(safe)
    return Object.keys(safe) as Array<keyof AppSettings>
  }

  /** Меняет настройки (из главного процесса) и сохраняет. */
  update(patch: SettingsPatch): void {
    this.setState((s) => mergeSettings(s, patch))
  }

  /** Сохраняет после каждого изменения. */
  protected override onChange(state: AppSettings): void {
    if (this.loading) return
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(state, null, 2))
      fs.renameSync(`${this.file}.tmp`, this.file)
    } catch (e) {
      this.onError((e as Error).message)
    }
  }

  /**
   * Пароль или ключ из `state.json` — расшифровывается один раз, дальше из памяти.
   * @returns Текст (пусто — значения нет) или `null`: не расшифровалось (доступ к связке ключей не разрешён,
   *   программу переподписали, сменился ключ системного хранилища).
   */
  private decode(stored: string): string | null {
    if (!stored) return ''
    if (this.plain.has(stored)) return this.plain.get(stored)!
    let text: string | null = null
    try {
      if (stored.startsWith('enc:')) text = safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
      else if (stored.startsWith('raw:')) text = Buffer.from(stored.slice(4), 'base64').toString()
    } catch {
      // доступ к связке ключей не разрешён или ключ системного хранилища сменился
    }
    this.plain.set(stored, text)
    return text
  }

  /** Шифрует пароль или ключ для `state.json` (шифрования нет — `raw:`); расшифровка запоминается сразу. */
  private encode(plain: string): string {
    if (!plain) return ''
    const stored = SettingsStore.encryptionAvailable() ? 'enc:' + safeStorage.encryptString(plain).toString('base64') : 'raw:' + Buffer.from(plain).toString('base64')
    this.plain.set(stored, plain)
    return stored
  }

  /** Доступно ли системное шифрование (не ответило — нет). */
  private static encryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }
}
