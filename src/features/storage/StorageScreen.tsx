/**
 * Вкладка «Хранилище» — как «Хранилище» мобильного приложения: куда сохранять (этот компьютер, сетевой диск,
 * Google Drive), у сетевого диска — учётная запись и расположение, у Google Drive — аккаунт, затем таблицы
 * с проверкой и лист Probe; когда таблицы не в Google Drive — «Устройства» (бирки с телефонов через копию Probe
 * в Google Drive), пояснение — в конце. У каждого места хранения свои файлы.
 *
 * Лаборатория и контроль качества (рабочее место на «Главной»): своё место хранения — этот компьютер или сетевой
 * диск (учётная запись и расположение — общие с цехом) и одна таблица (таблица коэффициентов, таблица качества);
 * Google Drive и «Устройств» нет.
 *
 * Сетевой диск: пока он не подключён (состояние проверяется при открытии и после правки сервера или папки),
 * таблицы на нём недоступны — пути, выбор файла и проверка. Обязательные поля (сервер, учётная запись без
 * «Без авторизации», пути к таблицам) — со звёздочкой, пустые подсвечены.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { BellIcon, DatabaseIcon, FolderIcon, GoogleDriveLogo, GoogleLogo, LockIcon, LockOpenIcon, LogoutIcon, PhoneIcon, PlugIcon, TableIcon, TrashIcon, UserIcon, WindowsLogo } from '@/components/icons/Icons'
import { Button, LockButton } from '@/components/ui/Button'
import { ActionTextInput, SecretInput, SelectInput, TextInput } from '@/components/ui/Inputs'
import { Field, FieldRow, FormSection, Notice, StatusBadge } from '@/components/ui/Layout'
import { List, ListItem, Switch } from '@/components/ui/List'
import { Tabs } from '@/components/ui/Tabs'
import { useLocale, useMessages } from '@/app/i18n'
import { message } from '@/shared/messages'
import { api, appInfoStore, runStore, settingsStore, useSettings, useStore } from '@/app/state'
import type { BridgeState, CheckResult, ShareResult } from '@/shared/protocol'
import { activeFiles, DESK_TARGETS, deskFile, deskOf, DESKS, isOneOf, MAC_VOLUMES, PASSWORD_MASK, TARGETS, uncPath, type AppSettings, type FileKind, type FileSet, type GoogleDriveSettings, type SmbSettings, type StorageTarget } from '@/shared/settings'
import './storage.css'

/** Поле файла. */
interface FileRow {
  /** Ключ проверки: место хранения, вид и номер Consum (`local:consum:0`). */
  id: string
  kind: FileKind
  file: string
  /** Номер Consum в списке. */
  index: number
}

/** Итог проверки: `busy` — идёт, `undefined` — не проверялось. */
type FileCheck = CheckResult | 'busy' | undefined

/** Пауза после правки пути перед проверкой, мс. */
const CHECK_DELAY_MS = 450

/** Пауза после правки сервера или общей папки перед проверкой подключения, мс. */
const SHARE_DELAY_MS = 600

/** Имена файлов в подсказке пути. */
const FILE_NAMES: Record<FileKind, string> = { consum: 'Consum otel.xlsx', sarjele: 'Sarjele din elemente.xlsx', probe: 'Probe otel.xlsx', laborator: 'Laborator.xlsx', calitate: 'Calitate.xlsx' }

/** Пример сервера и общей папки в путях, пока они не заданы. */
const EXAMPLE_HOST = 'server'
const EXAMPLE_SHARE = 'Atelier'

/** Папка примера, когда «Документы» неизвестны. */
const ELLIPSIS = '…'

/** Общая папка сетевого диска: `\\сервер\папка` в Windows, `/Volumes/папка` в macOS (туда её подключает система). */
const sharePath = (smb: Pick<SmbSettings, 'host' | 'share'>, windows: boolean) => {
  const example = { host: smb.host || EXAMPLE_HOST, share: smb.share || EXAMPLE_SHARE }
  return windows ? uncPath(example) : `${MAC_VOLUMES}/${example.share}`
}

/** Значки мест хранения — как в мобильном приложении. */
const TARGET_ICONS: Record<StorageTarget, ReactNode> = { local: <FolderIcon />, smb: <WindowsLogo />, googleDrive: <GoogleDriveLogo /> }

/** Поле под замком: путь к таблице, папка Google Drive или копия Probe для телефонов. */
type LockKey = keyof AppSettings['locked']

/** Кнопка замка поля пути: закрыт — правка недоступна; состояние хранится в настройках. */
function lockAction(settings: AppSettings, key: LockKey, t: TFunction<'storage'>) {
  const locked = settings.locked[key]
  return {
    icon: locked ? <LockIcon /> : <LockOpenIcon />,
    label: locked ? t('files.unlock') : t('files.lock'),
    tone: locked ? undefined : ('accent' as const),
    onClick: () => settingsStore.update({ locked: { [key]: !locked } }),
  }
}

/** Путь без кавычек (Finder и Проводник копируют путь в кавычках). */
const cleanPath = (v: string) => v.trim().replace(/^['"]|['"]$/g, '')

/**
 * Проверяет файлы: при открытии вкладки и после правки пути (с паузой). Пустой путь — «Путь не указан»
 * (таблица обязательна); недоступные таблицы (`enabled: false` — сетевой диск не подключён) не проверяются.
 * @param extraKey Меняется, когда проверку нужно повторить (лист Probe, листы проектов, папка и вход Google).
 */
function useFileChecks(rows: FileRow[], extraKey: string, enabled: boolean) {
  const [checks, setChecks] = useState<Record<string, FileCheck>>({})
  const timers = useRef<Record<string, number>>({})
  const run = async (r: FileRow) => {
    setChecks((c) => ({ ...c, [r.id]: 'busy' }))
    const res = await api.check(r.kind, r.file)
    setChecks((c) => ({ ...c, [r.id]: res }))
  }
  const sig = rows.map((r) => `${r.id}=${r.file}`).join('|')
  useEffect(() => {
    for (const r of rows) {
      window.clearTimeout(timers.current[r.id])
      if (!enabled) setChecks((c) => ({ ...c, [r.id]: undefined }))
      else if (!r.file) setChecks((c) => ({ ...c, [r.id]: { ok: false, msg: message('check.noPath') } }))
      else timers.current[r.id] = window.setTimeout(() => void run(r), CHECK_DELAY_MS)
    }
    const pending = timers.current
    return () => Object.values(pending).forEach((t) => window.clearTimeout(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- строки сравниваются по подписи
  }, [sig, extraKey, enabled])
  return { checks, run }
}

/** Подключение сетевого диска на экране. */
interface ShareState {
  /** Идёт проверка состояния. */
  checking: boolean
  /** Идёт подключение («Проверить подключение»). */
  mounting: boolean
  /** Итог последней проверки или подключения; `null` — ещё нет. */
  result: ShareResult | null
  connected: boolean
  /** «Проверить подключение»; `invalid` — почему подключаться не с чем (пустые обязательные поля). */
  mount: (invalid?: ShareResult['error']) => Promise<void>
}

/**
 * Подключение сетевого диска: состояние — при открытии и после правки сервера или общей папки (с паузой),
 * «Проверить подключение» подключает. Ответ устаревшего запроса (поля успели поменять) отбрасывается.
 */
function useShare(smb: SmbSettings, active: boolean): ShareState {
  const [checking, setChecking] = useState(false)
  const [mounting, setMounting] = useState(false)
  const [result, setResult] = useState<ShareResult | null>(null)
  const request = useRef(0)
  const failed = (error: unknown): ShareResult => ({ ok: false, error: message('error.other', { error: (error as Error).message }) })
  useEffect(() => {
    if (!active) return
    const id = ++request.current
    setResult(null)
    setChecking(true)
    const timer = window.setTimeout(() => {
      void api.smbStatus().catch(failed).then((r) => {
        if (id !== request.current) return
        setResult(r)
        setChecking(false)
      })
    }, SHARE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [smb.host, smb.share, active])
  const mount = async (invalid?: ShareResult['error']) => {
    const id = ++request.current
    setChecking(false)
    if (invalid) {
      setResult({ ok: false, error: invalid })
      return
    }
    setMounting(true)
    setResult(null)
    const r = await api.mountSmb().catch(failed)
    if (id === request.current) setResult(r)
    setMounting(false)
  }
  return { checking, mounting, result, connected: !!result?.ok, mount }
}

/** Вкладка «Хранилище». */
export function StorageScreen() {
  const { t } = useTranslation('storage')
  const settings = useSettings()
  const { platform, documents } = useStore(appInfoStore)
  const desk = deskOf(settings.workplace)
  // у лаборатории и контроля качества — своё место хранения
  const target: StorageTarget = desk ? settings.desks[desk].target : settings.target
  const files = activeFiles(settings)
  const drive = target === 'googleDrive'
  const rows: FileRow[] = desk
    ? [{ id: `${desk}:${target}`, kind: desk, file: deskFile(settings, desk), index: 0 }]
    : [
        ...files.consums.map((file, index) => ({ id: `${target}:consum:${index}`, kind: 'consum' as const, file, index })),
        { id: `${target}:sarjele`, kind: 'sarjele', file: files.sarjele, index: 0 },
        { id: `${target}:probe`, kind: 'probe', file: files.probe, index: 0 },
      ]
  const driveKey = drive ? `${settings.googleDrive.account}|${settings.googleDrive.folder}` : ''
  const share = useShare(settings.smb, target === 'smb')
  // таблицы на сетевом диске — только когда он подключён
  const offline = target === 'smb' && !share.connected
  const { checks, run } = useFileChecks(rows, desk ? '' : settings.sheet + '|' + settings.projects.map((p) => `${p.sheet}${p.create}${p.enabled}`).join('|') + '|' + driveKey, !offline)
  const setTarget = (next: StorageTarget) => {
    if (!desk) settingsStore.update({ target: next })
    else if (isOneOf(DESK_TARGETS)(next)) settingsStore.update({ desks: { [desk]: { ...settings.desks[desk], target: next } } })
  }

  return (
    <>
      <FormSection title={t('target.title')} icon={<DatabaseIcon />}>
        <Tabs
          label={t('target.title')}
          value={target}
          options={(desk ? DESK_TARGETS : TARGETS).map((option: StorageTarget) => ({ value: option, label: t(`target.${option}`), icon: TARGET_ICONS[option] }))}
          onChange={setTarget}
        />
      </FormSection>

      {/* `key` по рабочему месту и месту хранения: при переключении формы появляются анимацией. */}
      <div key={`${settings.workplace}:${target}`} className="storage-stack anim-enter">
        {target === 'smb' && <SmbSection smb={settings.smb} windows={platform === 'win32'} share={share} />}
        {drive && <DriveAccountSection drive={settings.googleDrive} />}
        <FilesSection settings={settings} target={target} rows={rows} checks={checks} recheck={(r) => void run(r)} windows={platform === 'win32'} documents={documents} offline={offline} waiting={offline && (share.checking || share.mounting)} />
        {!drive && !desk && <PhonesSection settings={settings} />}
      </div>

      {/* Как и куда пишутся таблицы — пояснение в конце, как в мобильном приложении. */}
      {!desk && <Notice>{t('intro', { days: settings.backupDays })}</Notice>}
    </>
  )
}

/**
 * Сетевой диск: учётная запись (нет при «Без авторизации»; имя и пароль обязательны), расположение (сервер
 * обязателен, общая папка — нет), «Проверить подключение» с состоянием под ней и переключатель «Без авторизации» —
 * подключение без имени и пароля, под текущей учётной записью системы.
 */
function SmbSection({ smb, windows, share }: { smb: SmbSettings; windows: boolean; share: ShareState }) {
  const { t } = useTranslation('storage')
  // пароль хранится только в главном процессе (зашифрованным); окно видит маску, пока пароль не нужен
  const [password, setPassword] = useState(smb.password)
  const set = (patch: Partial<SmbSettings>) => settingsStore.update({ smb: patch })
  const reveal = async () => {
    if (password === PASSWORD_MASK) setPassword(await api.smbPassword())
  }
  const account = !smb.anonymous
  const invalid = (value: string) => (value ? undefined : 'is-invalid')
  // подключаться не с чем — сказать сразу, не дёргая систему
  const missing = !smb.host ? message('smb.noHost') : account && (!smb.username || !password) ? message('smb.noAccount') : undefined

  return (
    <>
      {account && (
      <FormSection title={t('smb.account')} icon={<UserIcon />}>
        <FieldRow>
          <Field label={t('smb.domain')}>
            <TextInput placeholder={t('smb.domainPlaceholder')} value={smb.domain} onChange={(domain) => set({ domain })} />
          </Field>
          <Field label={t('smb.username')} required>
            <TextInput autoComplete="username" aria-required="true" className={invalid(smb.username)} value={smb.username} onChange={(username) => set({ username })} />
          </Field>
        </FieldRow>
        <Field label={t('smb.password')} required>
          <SecretInput
            autoComplete="current-password"
            aria-required="true"
            className={invalid(password)}
            value={password}
            onReveal={reveal}
            onChange={(p) => {
              setPassword(p)
              void api.setSettings({ smb: { password: p } })
            }}
            showLabel={t('smb.showPassword')}
            hideLabel={t('smb.hidePassword')}
          />
        </Field>
      </FormSection>
      )}

      <FormSection title={t('smb.location')} icon={<FolderIcon />} hint={t('smb.hint')}>
        <Field label={t('smb.host')} required>
          <TextInput placeholder={t('smb.hostPlaceholder')} aria-required="true" className={invalid(smb.host)} value={smb.host} onChange={(host) => set({ host: host.trim() })} />
        </Field>
        <Field label={t('smb.share')}>
          <TextInput placeholder={t('smb.sharePlaceholder')} value={smb.share} onChange={(value) => set({ share: value.trim() })} />
        </Field>
      </FormSection>

      <Button variant="tonal" icon={<PlugIcon />} busy={share.mounting} onClick={() => void share.mount(missing)}>
        {share.mounting ? t('smb.mounting') : t('smb.mount')}
      </Button>
      <div className="storage-check" role="status">
        <ShareStatus share={share} fallback={sharePath(smb, windows)} />
      </div>

      <List label={t('smb.anonymous')}>
        <ListItem
          itemRole="checkbox"
          leading={<UserIcon />}
          primary={t('smb.anonymous')}
          secondary={t('smb.anonymousHint')}
          selected={smb.anonymous}
          trailing={<Switch on={smb.anonymous} />}
          onClick={() => set({ anonymous: !smb.anonymous })}
        />
      </List>
    </>
  )
}

/** Состояние сетевого диска: проверяется, подключается, подключено (куда), не подключено или почему нет. */
function ShareStatus({ share, fallback }: { share: ShareState; fallback: string }) {
  const { t } = useTranslation('storage')
  const format = useMessages()
  const { mounting, checking, result } = share
  if (mounting) return <StatusBadge tone="info">{t('smb.mounting')}</StatusBadge>
  if (checking) return <StatusBadge tone="info">{t('smb.checking')}</StatusBadge>
  if (result?.ok) return <StatusBadge tone="success">{t('smb.connected', { mount: result.mount || fallback })}</StatusBadge>
  if (result?.error) return <StatusBadge tone="danger">{format(result.error)}</StatusBadge>
  if (result) return <StatusBadge tone="neutral">{t('smb.notConnected')}</StatusBadge>
  return null
}

/**
 * Аккаунт Google: «Войти через Google» (вход — в браузере системы), после входа — почта аккаунта,
 * а справа в заголовке — «Выйти» (доступ отзывается).
 */
function DriveAccountSection({ drive }: { drive: GoogleDriveSettings }) {
  const { t } = useTranslation('storage')
  const signOut = useDriveSignOut(drive)
  return (
    <FormSection
      title={t('googleDrive.account')}
      icon={<GoogleLogo />}
      action={drive.account ? <Button variant="text" icon={<LogoutIcon />} aria-label={t('googleDrive.signOutLabel')} onClick={() => void signOut()}>{t('googleDrive.signOut')}</Button> : undefined}
    >
      <DriveAccount drive={drive} />
    </FormSection>
  )
}

/** Выход из Google с подтверждением. */
function useDriveSignOut(drive: GoogleDriveSettings) {
  const { t } = useTranslation('storage')
  return async () => {
    const ok = await api.confirm({ title: t('googleDrive.signOutTitle'), message: t('googleDrive.signOutMessage', { account: drive.account }), ok: t('googleDrive.signOut') })
    if (ok) await api.driveSignOut()
  }
}

/** Вошедший аккаунт или «Войти через Google». */
function DriveAccount({ drive }: { drive: GoogleDriveSettings }) {
  const { t } = useTranslation('storage')
  const format = useMessages()
  const [signingIn, setSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signIn = async () => {
    setSigningIn(true)
    setError(null)
    const r = await api.driveSignIn()
    setSigningIn(false)
    if (!r.ok && r.error) setError(format(r.error))
  }
  return drive.account ? (
    <div className="storage-account">
      <StatusBadge tone="success">{t('googleDrive.signedIn', { account: drive.account })}</StatusBadge>
    </div>
  ) : (
    <>
      <Button variant="google" icon={<GoogleLogo />} busy={signingIn} onClick={() => void signIn()}>
        {signingIn ? t('googleDrive.signingIn') : t('googleDrive.signIn')}
      </Button>
      {error && <div className="storage-check" role="status"><StatusBadge tone="danger">{error}</StatusBadge></div>}
    </>
  )
}

/** Состояние моста строкой: что мешает, ждут ли бирки, когда копия сверена. */
function BridgeStatus({ bridge }: { bridge: BridgeState }) {
  const { t } = useTranslation('storage')
  const format = useMessages()
  const { time } = useLocale()
  if (bridge.problem) return <StatusBadge tone="danger">{format(bridge.problem)}</StatusBadge>
  if (bridge.waiting) return <StatusBadge tone="attention">{t('phones.waiting')}</StatusBadge>
  if (bridge.syncedAt) return <StatusBadge tone="success">{t('phones.synced', { time: time(bridge.syncedAt) })}</StatusBadge>
  return null
}

/**
 * Телефоны без доступа к сети компании: мобильное приложение пишет бирки в копию Probe в Google Drive, программа
 * переносит их в Probe и выкладывает Probe на место копии (`host/PhoneBridge`). Аккаунт и папка — общие с местом
 * хранения Google Drive, имя копии — его имя Probe.
 */
function PhonesSection({ settings }: { settings: AppSettings }) {
  const { t } = useTranslation('storage')
  const run = useStore(runStore)
  const drive = settings.googleDrive
  const signOut = useDriveSignOut(drive)
  const copyName = settings.files.googleDrive.probe
  // переключатель — под замком (закрывается снова при уходе с вкладки), как «Уведомления Firebase Firestore»
  const [locked, setLocked] = useState(true)
  const toggle = () => settingsStore.update({ bridge: !settings.bridge })
  return (
    <FormSection
      title={t('phones.title')}
      icon={<PhoneIcon />}
      action={settings.bridge && drive.account ? <Button variant="text" icon={<LogoutIcon />} aria-label={t('googleDrive.signOutLabel')} onClick={() => void signOut()}>{t('googleDrive.signOut')}</Button> : undefined}
      hint={settings.bridge ? t('phones.hint') : undefined}
    >
      <List label={t('phones.title')}>
        <ListItem
          itemRole="checkbox"
          leading={<GoogleDriveLogo />}
          primary={t('phones.enable')}
          secondary={t('phones.enableHint')}
          selected={settings.bridge}
          disabled={locked}
          aside={
            <>
              <LockButton locked={locked} label={locked ? t('phones.enableUnlock') : t('phones.enableLock')} onToggle={() => setLocked(!locked)} />
              {/* переключатель справа от замка — отдельной кнопкой (строку тоже можно нажать) */}
              <button type="button" className="switch-btn" tabIndex={-1} aria-hidden="true" disabled={locked} onClick={toggle}>
                <Switch on={settings.bridge} />
              </button>
            </>
          }
          onClick={toggle}
        />
      </List>
      {settings.bridge && (
        <>
          <DriveAccount drive={drive} />
          <Field label={t('googleDrive.folder')}>
            <ActionTextInput
              placeholder={t('googleDrive.folderPlaceholder')}
              value={drive.folder}
              onChange={(folder) => settingsStore.update({ googleDrive: { folder: folder.trim() } })}
              locked={settings.locked.folder}
              action={[lockAction(settings, 'folder', t)]}
            />
          </Field>
          <Field label={t('phones.copy')}>
            <ActionTextInput
              placeholder={FILE_NAMES.probe}
              value={copyName}
              onChange={(probe) => settingsStore.update({ files: { googleDrive: { ...settings.files.googleDrive, probe: probe.trim() } } })}
              locked={settings.locked.copy}
              action={[lockAction(settings, 'copy', t)]}
            />
          </Field>
          <div className="storage-check" role="status">
            <BridgeStatus bridge={run.bridge} />
          </div>
          <FirestoreBell settings={settings} bridge={run.bridge} />
        </>
      )}
    </FormSection>
  )
}

/**
 * «Звонок» телефонов через Firebase Firestore: телефон после записи сообщает программе, и перенос идёт сразу,
 * а не при проверке копии. Переключатель, ID проекта и ключ Web API — за замком (закрывается снова при уходе
 * с вкладки); слушает окно (`app/bellListener`), пока работает мост.
 */
function FirestoreBell({ settings, bridge }: { settings: AppSettings; bridge: BridgeState }) {
  const { t } = useTranslation('storage')
  const [locked, setLocked] = useState(true)
  const { firestore } = settings
  const toggle = () => settingsStore.update({ firestore: { enabled: !firestore.enabled } })
  return (
    <>
      <List label={t('phones.firestore')}>
        <ListItem
          itemRole="checkbox"
          leading={<BellIcon />}
          primary={t('phones.firestore')}
          secondary={t('phones.firestoreHint')}
          selected={firestore.enabled}
          disabled={locked}
          aside={
            <>
              <LockButton locked={locked} label={locked ? t('phones.firestoreUnlock') : t('phones.firestoreLock')} onToggle={() => setLocked(!locked)} />
              {/* переключатель справа от замка — отдельной кнопкой (строку тоже можно нажать) */}
              <button type="button" className="switch-btn" tabIndex={-1} aria-hidden="true" disabled={locked} onClick={toggle}>
                <Switch on={firestore.enabled} />
              </button>
            </>
          }
          onClick={toggle}
        />
      </List>
      {firestore.enabled && (
        <>
          <FieldRow>
            <Field label={t('phones.projectId')}>
              <TextInput placeholder="somascan-12345" value={firestore.projectId} readOnly={locked} className={locked ? 'is-locked' : undefined} onChange={(projectId) => settingsStore.update({ firestore: { projectId: projectId.trim() } })} />
            </Field>
            <Field label={t('phones.apiKey')}>
              <TextInput placeholder="AIza…" value={firestore.apiKey} readOnly={locked} className={locked ? 'is-locked' : undefined} onChange={(apiKey) => settingsStore.update({ firestore: { apiKey: apiKey.trim() } })} />
            </Field>
          </FieldRow>
          {bridge.bell && (
            <div className="storage-check" role="status">
              {bridge.bellError ? <StatusBadge tone="danger">{t('phones.bellFailed', { error: bridge.bellError })}</StatusBadge> : <StatusBadge tone="success">{t('phones.bellOn')}</StatusBadge>}
            </div>
          )}
        </>
      )}
    </>
  )
}

/** Свойства `FilesSection`. */
interface FilesSectionProps {
  settings: AppSettings
  /** Место хранения на экране: у лаборатории — своё. */
  target: StorageTarget
  rows: FileRow[]
  checks: Record<string, FileCheck>
  recheck: (row: FileRow) => void
  /** Окно в Windows (другие примеры путей). */
  windows: boolean
  /** Папка «Документы» этого компьютера — пример локального пути. */
  documents: string
  /** Сетевой диск не подключён: таблицы на нём недоступны. */
  offline: boolean
  /** Подключение проверяется или идёт: пояснение «подключитесь» пока не показывается. */
  waiting: boolean
}

/**
 * Таблицы (обязательны): у Google Drive — папка и имена файлов в ней, у остальных — пути к Consum, Sarjele и Probe;
 * у каждой — замок от случайной правки, выбор файла и проверка, итог — строкой под полем; в конце — лист Probe.
 * У лаборатории — одна таблица коэффициентов, без листа Probe. Сетевой диск не подключён — всё недоступно.
 */
function FilesSection({ settings, target, rows, checks, recheck, windows, documents, offline, waiting }: FilesSectionProps) {
  const { t } = useTranslation('storage')
  const format = useMessages()
  const { year } = useStore(appInfoStore)
  const files = activeFiles(settings)
  const drive = target === 'googleDrive'
  const desk = deskOf(settings.workplace)
  /** Меняет набор файлов текущего места хранения (другие места не трогаются). */
  const setFiles = (patch: Partial<FileSet>) => settingsStore.update({ files: { [settings.target]: { ...files, ...patch } } })
  const setConsums = (consums: string[]) => setFiles({ consums })
  const setPath = (r: FileRow, file: string) => {
    if (isOneOf(DESKS)(r.kind)) {
      const own = settings.desks[r.kind]
      settingsStore.update({ desks: { [r.kind]: { ...own, files: { ...own.files, [own.target]: file } } } })
    } else if (r.kind === 'consum') setConsums(files.consums.map((c, i) => (i === r.index ? file : c)))
    else setFiles({ [r.kind]: file })
  }
  const pick = async (r: FileRow) => {
    const f = await api.pick(r.kind, r.file)
    if (f) setPath(r, f)
  }
  const label = (r: FileRow) => (r.kind === 'consum' ? (files.consums.length > 1 ? t('files.consumN', { n: r.index + 1 }) : t('files.consum')) : t(`files.${r.kind}`))
  /** Пример пути: в Google Drive — имя файла, на сетевом диске — в общей папке, на этом компьютере — в «Документах». */
  const placeholder = (kind: FileKind) => {
    if (drive) return FILE_NAMES[kind]
    const folder = target === 'smb' ? sharePath(settings.smb, windows) : documents || ELLIPSIS
    return [folder, FILE_NAMES[kind]].join(windows ? '\\' : '/')
  }

  const probeCheck = checks[`${settings.target}:probe`]
  const probeSheets = (probeCheck && probeCheck !== 'busy' ? probeCheck.sheets : undefined) ?? []
  const sheetOptions = [
    { value: '', label: t('probeSheet.auto', { year }) },
    ...probeSheets.map((n) => ({ value: n, label: n })),
    ...(settings.sheet && !probeSheets.includes(settings.sheet) ? [{ value: settings.sheet, label: t('probeSheet.missing', { sheet: settings.sheet }) }] : []),
  ]

  return (
    <FormSection title={t('files.title')} icon={<TableIcon />} hint={drive ? t('googleDrive.hint') : t('files.hint')}>
      {offline && !waiting && <Notice>{t('files.needsShare')}</Notice>}
      {drive && (
        <Field label={t('googleDrive.folder')}>
          <ActionTextInput
            placeholder={t('googleDrive.folderPlaceholder')}
            value={settings.googleDrive.folder}
            onChange={(folder) => settingsStore.update({ googleDrive: { folder: folder.trim() } })}
            locked={settings.locked.folder}
            action={[lockAction(settings, 'folder', t)]}
          />
        </Field>
      )}
      {rows.map((r) => {
        const c = checks[r.id]
        const locked = settings.locked[r.kind]
        const removable = r.kind === 'consum' && files.consums.length > 1
        const check = {
          icon: <TableIcon />,
          label: t('files.check'),
          busy: c === 'busy',
          tone: c && c !== 'busy' ? (c.ok ? ('success' as const) : ('danger' as const)) : undefined,
          disabled: !r.file,
          onClick: () => recheck(r),
        }
        const remove = { icon: <TrashIcon />, label: t('files.remove'), disabled: locked, onClick: () => setConsums(files.consums.filter((_, i) => i !== r.index)) }
        return (
          <div key={r.id} className="file-field">
            <Field label={label(r)} required>
              <ActionTextInput
                placeholder={placeholder(r.kind)}
                value={r.file}
                onChange={(v) => setPath(r, cleanPath(v))}
                locked={locked}
                disabled={offline}
                aria-required="true"
                className={!r.file && !offline ? 'is-invalid' : undefined}
                action={[
                  lockAction(settings, r.kind, t),
                  // в Google Drive файл задаётся именем в папке — выбора файла на этом компьютере нет
                  ...(drive ? [] : [{ icon: <FolderIcon />, label: t('files.pick'), disabled: locked, onClick: () => void pick(r) }]),
                  removable ? remove : check,
                ]}
              />
            </Field>
            <div className="storage-check" role="status">
              {c === 'busy' ? <StatusBadge tone="info">{t('files.checking')}</StatusBadge> : c ? <StatusBadge tone={c.ok ? 'success' : 'danger'}>{format(c.msg)}</StatusBadge> : null}
            </div>
          </div>
        )
      })}
      {!desk && (
        <Field label={t('probeSheet.label')}>
          <SelectInput value={settings.sheet} options={sheetOptions} disabled={offline} onChange={(sheet) => settingsStore.update({ sheet })} />
        </Field>
      )}
    </FormSection>
  )
}
