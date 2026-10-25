/**
 * Вкладка «Хранилище»: где лежат таблицы (этот компьютер или сетевой диск), пути к ним с проверкой и лист Probe.
 * У каждого места хранения свои файлы.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DatabaseIcon, FolderIcon, LockIcon, LockOpenIcon, PlugIcon, TableIcon, TrashIcon, UserIcon, WindowsLogo } from '@/components/icons/Icons'
import { Button } from '@/components/ui/Button'
import { ActionTextInput, SecretInput, SelectInput, TextInput } from '@/components/ui/Inputs'
import { Field, FieldRow, FormSection, Notice, StatusBadge } from '@/components/ui/Layout'
import { Tabs } from '@/components/ui/Tabs'
import { useMessages } from '@/app/i18n'
import { api, appInfoStore, settingsStore, useSettings, useStore } from '@/app/state'
import type { CheckResult } from '@/shared/protocol'
import { activeFiles, PASSWORD_MASK, type AppSettings, type FileKind, type FileSet, type SmbSettings } from '@/shared/settings'
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

/** Путь без кавычек (Finder и Проводник копируют путь в кавычках). */
const cleanPath = (v: string) => v.trim().replace(/^['"]|['"]$/g, '')

/**
 * Проверяет файлы: при открытии вкладки и после правки пути (с паузой).
 * @param extraKey Меняется, когда проверку нужно повторить (лист Probe, листы проектов).
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
  const { year, platform } = useStore(appInfoStore)
  const files = activeFiles(settings)
  const rows: FileRow[] = [
    ...files.consums.map((file, index) => ({ id: `${settings.target}:consum:${index}`, kind: 'consum' as const, file, index })),
    { id: `${settings.target}:sarjele`, kind: 'sarjele', file: files.sarjele, index: 0 },
    { id: `${settings.target}:probe`, kind: 'probe', file: files.probe, index: 0 },
  ]
  const { checks, run } = useFileChecks(rows, settings.sheet + '|' + settings.projects.map((p) => `${p.sheet}${p.create}${p.enabled}`).join('|'))
  const probeCheck = checks[`${settings.target}:probe`]
  const probeSheets = (probeCheck && probeCheck !== 'busy' ? probeCheck.sheets : undefined) ?? []
  const sheetOptions = [
    { value: '', label: t('probeSheet.auto', { year }) },
    ...probeSheets.map((n) => ({ value: n, label: n })),
    ...(settings.sheet && !probeSheets.includes(settings.sheet) ? [{ value: settings.sheet, label: t('probeSheet.missing', { sheet: settings.sheet }) }] : []),
  ]

  return (
    <>
      <Notice>{t('intro', { days: settings.backupDays })}</Notice>

      <FormSection title={t('target.title')} icon={<DatabaseIcon />}>
        <Tabs
          label={t('target.title')}
          value={settings.target}
          options={[
            { value: 'local', label: t('target.local'), icon: <FolderIcon /> },
            { value: 'smb', label: t('target.smb'), icon: <WindowsLogo /> },
          ]}
          onChange={(target) => settingsStore.update({ target })}
        />
      </FormSection>

      {settings.target === 'smb' && <SmbSection smb={settings.smb} />}

      <FilesSection key={settings.target} settings={settings} rows={rows} checks={checks} recheck={(r) => void run(r)} windows={platform === 'win32'} />

      <FormSection title={t('probeSheet.title')} icon={<TableIcon />} hint={t('probeSheet.hint')}>
        <Field label={t('probeSheet.label')}>
          <SelectInput value={settings.sheet} options={sheetOptions} onChange={(sheet) => settingsStore.update({ sheet })} />
        </Field>
      </FormSection>
    </>
  )
}

/** Сетевой диск: адрес, учётная запись и подключение. */
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
    <div className="anim-enter">
      <FormSection title={t('smb.title')} icon={<PlugIcon />} hint={t('smb.hint')}>
        <FieldRow>
          <Field label={t('smb.host')}>
            <TextInput placeholder={t('smb.hostPlaceholder')} value={smb.host} onChange={(host) => set({ host })} />
          </Field>
          <Field label={t('smb.share')}>
            <TextInput placeholder="Somaco" value={smb.share} onChange={(share) => set({ share })} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label={t('smb.domain')}>
            <TextInput placeholder="SOMACO" value={smb.domain} onChange={(domain) => set({ domain })} />
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
        <Button variant="tonal" icon={<UserIcon />} busy={mounting} onClick={() => void mount()}>
          {mounting ? t('smb.mounting') : t('smb.mount')}
        </Button>
      </FormSection>
    </div>
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

/** Пути к Consum, Sarjele и Probe с проверкой каждого; замок от случайной правки. */
function FilesSection({ settings, rows, checks, recheck, windows }: FilesSectionProps) {
  const { t } = useTranslation('storage')
  const format = useMessages()
  const files = activeFiles(settings)
  /** Меняет набор файлов текущего места хранения (другое место не трогается). */
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
  const placeholder = (kind: FileKind) => (windows ? `\\\\server\\share\\…\\${FILE_NAMES[kind]}` : `/Volumes/…/${FILE_NAMES[kind]}`)

  return (
    <FormSection title={t('files.title')} icon={<TableIcon />} hint={t('files.hint')}>
      {rows.map((r) => {
        const c = checks[r.id]
        const locked = settings.locked[r.kind]
        const removable = r.kind === 'consum' && files.consums.length > 1
        return (
          <div key={r.id} className="file-field">
            <Field label={label(r)}>
              <ActionTextInput
                placeholder={placeholder(r.kind)}
                value={r.file}
                onChange={(v) => setPath(r, cleanPath(v))}
                locked={locked}
                action={[
                  {
                    icon: locked ? <LockIcon /> : <LockOpenIcon />,
                    label: locked ? t('files.unlock') : t('files.lock'),
                    tone: locked ? undefined : 'accent',
                    onClick: () => settingsStore.update({ locked: { [r.kind]: !locked } }),
                  },
                  { icon: <FolderIcon />, label: t('files.pick'), disabled: locked, onClick: () => void pick(r) },
                  removable
                    ? { icon: <TrashIcon />, label: t('files.remove'), disabled: locked, onClick: () => setConsums(files.consums.filter((_, i) => i !== r.index)) }
                    : {
                        icon: <TableIcon />,
                        label: t('files.check'),
                        busy: c === 'busy',
                        tone: c && c !== 'busy' ? (c.ok ? 'success' : 'danger') : undefined,
                        disabled: !r.file,
                        onClick: () => recheck(r),
                      },
                ]}
              />
            </Field>
            <div className="storage-check" role="status">
              {c === 'busy' ? <StatusBadge tone="info">{t('files.checking')}</StatusBadge> : c ? <StatusBadge tone={c.ok ? 'success' : 'danger'}>{format(c.msg)}</StatusBadge> : null}
            </div>
          </div>
        )
      })}
    </FormSection>
  )
}
