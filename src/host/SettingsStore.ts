/**
 * Настройки программы в главном процессе: `userData/state.json`.
 *
 * Запись — через временный файл и переименование, чтобы сбой посреди записи не испортил файл.
 * Окно получает копию с маской вместо пароля (`publicSettings`); изменения из окна приходят патчем (`apply`).
 * Флаг `running` (воля пользователя «слежение включено») меняют только «Старт» и «Стоп».
 *
 * Пароль сетевого диска и ключ доступа к Google Drive на диске — только зашифрованными системным хранилищем
 * (Keychain / DPAPI через `safeStorage`). Если шифрование недоступно, они хранятся в base64 с пометкой `raw:`
 * (это не защита). Ключ Google в окно не отдаётся вовсе, а почту аккаунта и ключ меняет только вход и выход.
 * РИСК: без системного шифрования (`raw:`) пароль и ключ читаются любым, у кого есть доступ к `state.json`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import { Store } from '@/shared/Store'
import { formatIn, type Message } from '@/shared/messages'
import { activeFiles, DEFAULT_SETTINGS, mergeSettings, parseSettings, PASSWORD_MASK, type AppSettings, type FileSet, type SettingsPatch } from '@/shared/settings'

/** Хранилище настроек. */
export class SettingsStore extends Store<AppSettings> {
  /** Файл настроек. */
  private readonly file: string
  /** Куда сообщать об ошибке записи. */
  private readonly onError: (error: string) => void
  /** Идёт чтение с диска — сохранять нечего. */
  private loading = false
  /** Имена таблиц Google Drive → пути их локальной копии (задаёт `HostServices`, см. `DriveMirror`). */
  resolveDrive: (folder: string, names: FileSet) => FileSet = (_folder, names) => names

  /**
   * @param file `state.json`.
   * @param onError Ошибка записи (в журнал).
   */
  constructor(file: string, onError: (error: string) => void) {
    super(DEFAULT_SETTINGS)
    this.file = file
    this.onError = onError
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
  }

  /** Текст сообщения на языке интерфейса (трей, диалоги). */
  text(m: Message): string {
    return formatIn(this.getSnapshot().language, m)
  }

  /** Настройки для окна: пароль заменён маской, ключа Google нет. */
  publicSettings(): AppSettings {
    const s = this.getSnapshot()
    return { ...s, smb: { ...s.smb, password: s.smb.password ? PASSWORD_MASK : '' }, googleDrive: { ...s.googleDrive, token: '' } }
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

  /** Расшифрованный пароль сетевого диска (не удалось — пусто: ключ сменился, пароль придётся ввести заново). */
  smbPassword(): string {
    return SettingsStore.decrypt(this.getSnapshot().smb.password)
  }

  /** Расшифрованный ключ доступа к Google Drive (refresh-токен); пусто — нужен вход. */
  driveToken(): string {
    return SettingsStore.decrypt(this.getSnapshot().googleDrive.token)
  }

  /** Вход или выход Google: почта аккаунта и ключ доступа (пустые — выход). */
  setDriveAccount(account: string, token: string): void {
    this.update({ googleDrive: { account, token: SettingsStore.encrypt(token) } })
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
      safe.smb = { ...safe.smb, password: p === PASSWORD_MASK ? this.getSnapshot().smb.password : SettingsStore.encrypt(p) }
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

  /** Расшифровывает пароль или ключ из `state.json` (не удалось — пусто: ключ системного хранилища сменился). */
  private static decrypt(stored: string): string {
    try {
      if (stored.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
      if (stored.startsWith('raw:')) return Buffer.from(stored.slice(4), 'base64').toString()
    } catch {
      // ключ системного хранилища сменился
    }
    return ''
  }

  /** Шифрует пароль или ключ для `state.json`. */
  private static encrypt(plain: string): string {
    if (!plain) return ''
    return safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(plain).toString('base64') : 'raw:' + Buffer.from(plain).toString('base64')
  }
}
