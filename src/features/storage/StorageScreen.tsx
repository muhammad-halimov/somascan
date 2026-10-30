/**
 * Вкладка «Хранилище» — как «Хранилище» мобильного приложения: куда сохранять (этот компьютер, сетевой диск,
 * Google Drive), у сетевого диска — учётная запись и расположение, у Google Drive — аккаунт, затем таблицы
 * с проверкой и лист Probe, пояснение — в конце. У каждого места хранения свои файлы.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DatabaseIcon, FolderIcon, GoogleDriveLogo, GoogleLogo, LockIcon, LockOpenIcon, LogoutIcon, PlugIcon, TableIcon, TrashIcon, UserIcon, WindowsLogo } from '@/components/icons/Icons'
import { Button } from '@/components/ui/Button'
import { ActionTextInput, SecretInput, SelectInput, TextInput } from '@/components/ui/Inputs'
import { Field, FieldRow, FormSection, Notice, StatusBadge } from '@/components/ui/Layout'
import { Tabs } from '@/components/ui/Tabs'
import { useMessages } from '@/app/i18n'
import { api, appInfoStore, settingsStore, useSettings, useStore } from '@/app/state'
import type { CheckResult } from '@/shared/protocol'
import { activeFiles, PASSWORD_MASK, TARGETS, type AppSettings, type FileKind, type FileSet, type GoogleDriveSettings, type SmbSettings, type StorageTarget } from '@/shared/settings'
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

/** Имена файлов в подсказке пути. */
const FILE_NAMES: Record<FileKind, string> = { consum: '09-Consum Otel ….xlsx', sarjele: 'Sarjele din elemente.xlsx', probe: 'Probe otel.xlsx' }

/** Значки мест хранения — как в мобильном приложении. */
const TARGET_ICONS: Record<StorageTarget, ReactNode> = { local: <FolderIcon />, smb: <WindowsLogo />, googleDrive: <GoogleDriveLogo /> }

/** Путь без кавычек (Finder и Проводник копируют путь в кавычках). */
const cleanPath = (v: string) => v.trim().replace(/^['"]|['"]$/g, '')

/**
 * Проверяет файлы: при открытии вкладки и после правки пути (с паузой).
 * @param extraKey Меняется, когда проверку нужно повторить (лист Probe, листы проектов, папка и вход Google).
 */
function useFileChecks(rows: FileRow[], extraKey: string) {
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
      if (!r.file) {
        setChecks((c) => ({ ...c, [r.id]: undefined }))
        continue
      }
      timers.current[r.id] = window.setTimeout(() => void run(r), CHECK_DELAY_MS)
    }
    const pending = timers.current
    return () => Object.values(pending).forEach((t) => window.clearTimeout(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- строки сравниваются по подписи
  }, [sig, extraKey])
  return { checks, run }
}

/** Вкладка «Хранилище». */
export function StorageScreen() {
  const { t } = useTranslation('storage')
  const settings = useSettings()
  const { platform } = useStore(appInfoStore)
  const files = activeFiles(settings)
  const drive = settings.target === 'googleDrive'
  const rows: FileRow[] = [
    ...files.consums.map((file, index) => ({ id: `${settings.target}:consum:${index}`, kind: 'consum' as const, file, index })),
    { id: `${settings.target}:sarjele`, kind: 'sarjele', file: files.sarjele, index: 0 },
    { id: `${settings.target}:probe`, kind: 'probe', file: files.probe, index: 0 },
  ]
  const driveKey = drive ? `${settings.googleDrive.account}|${settings.googleDrive.folder}` : ''
  const { checks, run } = useFileChecks(rows, settings.sheet + '|' + settings.projects.map((p) => `${p.sheet}${p.create}${p.enabled}`).join('|') + '|' + driveKey)

  return (
    <>
      <FormSection title={t('target.title')} icon={<DatabaseIcon />}>
        <Tabs
          label={t('target.title')}
          value={settings.target}
          options={TARGETS.map((target) => ({ value: target, label: t(`target.${target}`), icon: TARGET_ICONS[target] }))}
          onChange={(target) => settingsStore.update({ target })}
        />
      </FormSection>

      {/* `key` по месту хранения: при переключении формы появляются анимацией. */}
      <div key={settings.target} className="storage-stack anim-enter">
        {settings.target === 'smb' && <SmbSection smb={settings.smb} />}
        {drive && <DriveAccountSection drive={settings.googleDrive} />}
        <FilesSection settings={settings} rows={rows} checks={checks} recheck={(r) => void run(r)} windows={platform === 'win32'} />
      </div>

      {/* Как и куда пишутся таблицы — пояснение в конце, как в мобильном приложении. */}
      <Notice>{t('intro', { days: settings.backupDays })}</Notice>
    </>
  )
}

/** Сетевой диск: сначала учётная запись, затем расположение и «Подключить диск». */
function SmbSection({ smb }: { smb: SmbSettings }) {
  const { t } = useTranslation('storage')
  // пароль хранится только в главном процессе (зашифрованным); окно видит маску, пока пароль не нужен
  const [password, setPassword] = useState(smb.password)
  const [mounting, setMounting] = useState(false)
  const set = (patch: Partial<SmbSettings>) => settingsStore.update({ smb: patch })
  const reveal = async () => {
    if (password === PASSWORD_MASK) setPassword(await api.smbPassword())
  }
  const mount = async () => {
    setMounting(true)
    await api.mountSmb()
    setMounting(false)
  }

  return (
    <>
      <FormSection title={t('smb.account')} icon={<UserIcon />}>
        <FieldRow>
          <Field label={t('smb.domain')}>
            <TextInput placeholder={t('smb.domainPlaceholder')} value={smb.domain} onChange={(domain) => set({ domain })} />
          </Field>
          <Field label={t('smb.username')}>
            <TextInput autoComplete="username" value={smb.username} onChange={(username) => set({ username })} />
          </Field>
        </FieldRow>
        <Field label={t('smb.password')}>
          <SecretInput
            autoComplete="current-password"
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

      <FormSection title={t('smb.location')} icon={<FolderIcon />} hint={t('smb.hint')}>
        <Field label={t('smb.host')}>
          <TextInput placeholder={t('smb.hostPlaceholder')} value={smb.host} onChange={(host) => set({ host })} />
        </Field>
        <Field label={t('smb.share')}>
          <TextInput placeholder={t('smb.sharePlaceholder')} value={smb.share} onChange={(share) => set({ share })} />
        </Field>
      </FormSection>

      <Button variant="tonal" icon={<PlugIcon />} busy={mounting} onClick={() => void mount()}>
        {mounting ? t('smb.mounting') : t('smb.mount')}
      </Button>
    </>
  )
}

/**
 * Аккаунт Google: «Войти через Google» (вход — в браузере системы), после входа — почта аккаунта,
 * а справа в заголовке — «Выйти» (доступ отзывается).
 */
function DriveAccountSection({ drive }: { drive: GoogleDriveSettings }) {
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
  const signOut = async () => {
    const ok = await api.confirm({ title: t('googleDrive.signOutTitle'), message: t('googleDrive.signOutMessage', { account: drive.account }), ok: t('googleDrive.signOut') })
    if (ok) await api.driveSignOut()
  }

  return (
    <FormSection
      title={t('googleDrive.account')}
      icon={<GoogleLogo />}
      action={drive.account ? <Button variant="text" icon={<LogoutIcon />} aria-label={t('googleDrive.signOutLabel')} onClick={() => void signOut()}>{t('googleDrive.signOut')}</Button> : undefined}
    >
      {drive.account ? (
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
      )}
    </FormSection>
  )
}

/** Свойства `FilesSection`. */
interface FilesSectionProps {
  settings: AppSettings
  rows: FileRow[]
  checks: Record<string, FileCheck>
  recheck: (row: FileRow) => void
  /** Окно в Windows (другие примеры путей). */
  windows: boolean
}

/**
 * Таблицы: у Google Drive — папка и имена файлов в ней, у остальных — пути к Consum, Sarjele и Probe; у каждой —
 * замок от случайной правки, выбор файла и проверка, итог — строкой под полем; в конце — лист Probe.
 */
function FilesSection({ settings, rows, checks, recheck, windows }: FilesSectionProps) {
  const { t } = useTranslation('storage')
  const format = useMessages()
  const { year } = useStore(appInfoStore)
  const files = activeFiles(settings)
  const drive = settings.target === 'googleDrive'
  /** Меняет набор файлов текущего места хранения (другие места не трогаются). */
  const setFiles = (patch: Partial<FileSet>) => settingsStore.update({ files: { [settings.target]: { ...files, ...patch } } })
  const setConsums = (consums: string[]) => setFiles({ consums })
  const setPath = (r: FileRow, file: string) => {
    if (r.kind === 'consum') setConsums(files.consums.map((c, i) => (i === r.index ? file : c)))
    else setFiles({ [r.kind]: file })
  }
  const pick = async (r: FileRow) => {
    const f = await api.pick(r.kind, r.file)
    if (f) setPath(r, f)
  }
  const label = (r: FileRow) => (r.kind === 'consum' ? (files.consums.length > 1 ? t('files.consumN', { n: r.index + 1 }) : t('files.consum')) : t(`files.${r.kind}`))
  const placeholder = (kind: FileKind) => (drive ? FILE_NAMES[kind] : windows ? `\\\\server\\share\\…\\${FILE_NAMES[kind]}` : `/Volumes/…/${FILE_NAMES[kind]}`)
  const lockAction = (key: FileKind | 'folder') => {
    const locked = settings.locked[key]
    return {
      icon: locked ? <LockIcon /> : <LockOpenIcon />,
      label: locked ? t('files.unlock') : t('files.lock'),
      tone: locked ? undefined : ('accent' as const),
      onClick: () => settingsStore.update({ locked: { [key]: !locked } }),
    }
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
      {drive && (
        <Field label={t('googleDrive.folder')}>
          <ActionTextInput
            placeholder={t('googleDrive.folderPlaceholder')}
            value={settings.googleDrive.folder}
            onChange={(folder) => settingsStore.update({ googleDrive: { folder: folder.trim() } })}
            locked={settings.locked.folder}
            action={[lockAction('folder')]}
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
            <Field label={label(r)}>
              <ActionTextInput
                placeholder={placeholder(r.kind)}
                value={r.file}
                onChange={(v) => setPath(r, cleanPath(v))}
                locked={locked}
                action={[
                  lockAction(r.kind),
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
      <Field label={t('probeSheet.label')}>
        <SelectInput value={settings.sheet} options={sheetOptions} onChange={(sheet) => settingsStore.update({ sheet })} />
      </Field>
    </FormSection>
  )
}
