/**
 * Вкладка «Расширенные»: таймер, правила (только у цеха), подпись рабочего места (инженер-координатор цеха, лаборант,
 * контролёр качества), резервные копии (как в мобильном приложении), действия (разовые прогоны, миграция, откат,
 * переключатели), система (язык, тема, автозапуск, трей) и «О приложении» с версией в конце.
 * У лаборатории и контроля качества нет правил выбора плавки, подключения новых проектов и ручных привязок — это
 * настройки цеха; миграция есть у цеха (ID) и лаборатории (бюллетень и дата в свои колонки). Лаборатория таблицу
 * только читает: разовый прогон — «Прочитать таблицу», записи нет; у контроля качества разовых прогонов пока нет.
 * В подписях вместо Consum, Sarjele и Probe — таблица рабочего места (перевод с контекстом рабочего места:
 * `_laborator`, `_calitate`).
 */
import { useEffect, useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarIcon, ClockIcon, FactoryIcon, FileIcon, FlagGB, FlagRO, FlagRU, FlagTJ, ImageIcon, InfoIcon, LinkIcon, ListIcon, MonitorIcon, MoonIcon, PlayIcon, RefreshIcon, ResetIcon, SignatureIcon, SunIcon, TableIcon, TrashIcon, WrenchIcon } from '@/components/icons/Icons'
import { Button, LockButton } from '@/components/ui/Button'
import { FormSection, Notice, StatusBadge } from '@/components/ui/Layout'
import { List, ListItem, Switch } from '@/components/ui/List'
import { Tabs } from '@/components/ui/Tabs'
import { useLocale, useMessages } from '@/app/i18n'
import { api, appInfoStore, runStore, settingsStore, useSettings, useStore } from '@/app/state'
import type { Message } from '@/shared/messages'
import type { ActionName, SignatureImage } from '@/shared/protocol'
import { LANGUAGES, type AppSettings, type Language, type Workplace } from '@/shared/settings'
import './settings.css'

/** Интервалы проверки и паузы после изменения, с (до 10 с). */
const INTERVALS = [2, 3, 5, 10]
const SETTLES = [1, 3, 5, 10]
/** Сроки хранения копий, дн. (как в мобильном приложении). */
const BACKUP_DAYS = [7, 30, 90, 365]

/** Языки: название на самом языке и флаг. */
const LANGUAGE_OPTIONS: Record<Language, { name: string; flag: ComponentType }> = {
  en: { name: 'English', flag: FlagGB },
  ro: { name: 'Română', flag: FlagRO },
  tj: { name: 'Тоҷикӣ', flag: FlagTJ },
  ru: { name: 'Русский', flag: FlagRU },
}

/** Метка бэкапа → время: «2026-10-19T14-02-11-123Z» → дата. */
const stampTime = (stamp: string): number => Date.parse(stamp.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, 'T$1:$2:$3.$4Z'))

/** Вкладка «Расширенные». */
export function SettingsScreen({ goHome }: { goHome: () => void }) {
  const settings = useSettings()
  const run = useStore(runStore)
  const atelier = settings.workplace === 'atelier'
  return (
    <>
      <TimerSection settings={settings} />
      {atelier && <RulesSection settings={settings} />}
      <SignatureSection settings={settings} place={settings.workplace} />
      <BackupsSection settings={settings} />
      <ActionsSection settings={settings} busy={!!run.busy} goHome={goHome} />
      <SystemSection settings={settings} />
      <AboutSection />
    </>
  )
}

/** Интервал проверки Consum и пауза после изменения файла. */
function TimerSection({ settings }: { settings: AppSettings }) {
  const { t } = useTranslation('settings')
  const seconds = (values: number[]) => values.map((s) => ({ value: s, label: t('timer.seconds', { n: s }), icon: <ClockIcon /> }))
  return (
    <FormSection title={t('timer.title')} icon={<RefreshIcon />} hint={t('timer.hint', { context: settings.workplace })}>
      <span className="form-section-hint">{t('timer.interval')}</span>
      <Tabs label={t('timer.interval')} value={settings.intervalSec} options={seconds(INTERVALS)} onChange={(intervalSec) => settingsStore.update({ intervalSec })} />
      <span className="form-section-hint">{t('timer.settle')}</span>
      <Tabs label={t('timer.settle')} value={settings.settleSec} options={seconds(SETTLES)} onChange={(settleSec) => settingsStore.update({ settleSec })} />
    </FormSection>
  )
}

/** С какой плавки брать металл. */
function RulesSection({ settings }: { settings: AppSettings }) {
  const { t } = useTranslation('settings')
  return (
    <FormSection title={t('rules.title')} icon={<ListIcon />}>
      <span className="form-section-hint">{t('rules.heat')}</span>
      <Tabs
        label={t('rules.heatLabel')}
        value={settings.rule}
        options={[
          { value: 'latest', label: t('rules.latest'), icon: <ListIcon /> },
          { value: 'oldest', label: t('rules.oldest'), icon: <CalendarIcon /> },
        ]}
        onChange={(rule) => settingsStore.update({ rule })}
      />
    </FormSection>
  )
}

/**
 * Подпись рабочего места (инженер-координатор цеха, лаборант, контролёр качества — заголовок по рабочему месту): изображение
 * с прозрачным фоном (хранится в папке данных программы, `host/SignatureService`) и превью. Превью — на белом листе
 * в клетку в любой теме: тёмная подпись не сливается с тёмным окном, а клетка показывает, где фон прозрачный.
 * «Убрать» — в заголовке, с подтверждением.
 */
function SignatureSection({ settings, place }: { settings: AppSettings; place: Workplace }) {
  const { t } = useTranslation('settings')
  const format = useMessages()
  const file = settings.signatures[place]
  const [image, setImage] = useState<SignatureImage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Message | null>(null)
  // путь меняется при каждой замене — превью перечитывается
  useEffect(() => {
    let live = true
    if (!file) setImage(null)
    else void api.signature(place).then((img) => live && setImage(img))
    return () => {
      live = false
    }
  }, [file, place])
  const pick = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.pickSignature(place)
      if (r && !r.ok && r.error) setError(r.error)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    const ok = await api.confirm({ title: t('signature.removeTitle'), message: t('signature.removeMessage'), ok: t('signature.remove'), cancel: t('actions.cancel') })
    if (!ok) return
    setError(null)
    await api.removeSignature(place)
  }
  return (
    <FormSection
      title={t('signature.title', { context: place })}
      icon={<SignatureIcon />}
      hint={t('signature.hint')}
      action={file ? <Button variant="text" icon={<TrashIcon />} aria-label={t('signature.removeLabel')} onClick={() => void remove()}>{t('signature.remove')}</Button> : undefined}
    >
      <div className={`signature-preview${image ? '' : ' is-empty'}`}>
        {image ? <img src={image.dataUrl} alt={t('signature.alt')} /> : <span>{t('signature.empty')}</span>}
      </div>
      <Button variant="tonal" icon={<ImageIcon />} busy={busy} onClick={() => void pick()}>
        {file ? t('signature.replace') : t('signature.pick')}
      </Button>
      {error && (
        <div className="signature-status" role="status">
          <StatusBadge tone="danger">{format(error)}</StatusBadge>
        </div>
      )}
    </FormSection>
  )
}

/** Сколько хранить копии таблиц — как «Резервные копии» мобильного приложения. */
function BackupsSection({ settings }: { settings: AppSettings }) {
  const { t } = useTranslation('settings')
  return (
    <FormSection title={t('backups.title')} icon={<ClockIcon />} hint={t('backups.hint', { context: settings.workplace })}>
      <span className="form-section-hint">{t('backups.keep')}</span>
      <Tabs
        label={t('backups.keep')}
        value={settings.backupDays}
        options={BACKUP_DAYS.map((count) => ({ value: count, label: t('backups.days', { count }), icon: <CalendarIcon /> }))}
        onChange={(backupDays) => settingsStore.update({ backupDays })}
      />
    </FormSection>
  )
}

/** Разовые прогоны, миграция ID, запись в открытые файлы, новые проекты, ручные привязки, откат из бэкапа. */
function ActionsSection({ settings, busy, goHome }: { settings: AppSettings; busy: boolean; goHome: () => void }) {
  const { t } = useTranslation('settings')
  const { dateTime } = useLocale()
  const [backups, setBackups] = useState<string[] | null>(null)
  const [guardLocked, setGuardLocked] = useState(true)
  const toggleGuard = () => settingsStore.update({ guardOpenFiles: !settings.guardOpenFiles })
  const context = settings.workplace
  const atelier = context === 'atelier'

  const act = async (name: ActionName) => {
    if (name === 'write' || name === 'migrate-write') {
      const ok = await api.confirm({
        title: t('actions.confirmWriteTitle'),
        message: name === 'write' ? t('actions.confirmWrite') : t('actions.confirmMigrate', { context }),
        ok: t('actions.confirmWriteOk'),
        cancel: t('actions.cancel'),
      })
      if (!ok) return
    }
    goHome()
    void api.action(name)
  }
  const restore = async (stamp: string) => {
    const when = stamp.startsWith('before-restore') ? stamp : dateTime(stampTime(stamp))
    const ok = await api.confirm({ title: t('actions.confirmRestoreTitle'), message: t('actions.confirmRestore', { stamp: when, context }), ok: t('actions.confirmRestoreOk'), cancel: t('actions.cancel') })
    if (!ok) return
    goHome()
    void api.restore(stamp)
  }

  return (
    <FormSection title={t('actions.title')} icon={<WrenchIcon />} hint={t('actions.hint')}>
      <List label={t('actions.title')}>
        {context !== 'calitate' && <ListItem leading={<PlayIcon />} primary={t('actions.plan', { context })} secondary={t('actions.planHint', { context })} onClick={() => void act('plan')} disabled={busy} />}
        {atelier && <ListItem leading={<PlayIcon />} primary={t('actions.write')} secondary={t('actions.writeHint')} onClick={() => void act('write')} disabled={busy} />}
        {context !== 'calitate' && (
          <>
            <ListItem leading={<TableIcon />} primary={t('actions.migratePlan')} secondary={t('actions.migratePlanHint', { context })} onClick={() => void act('migrate-plan')} disabled={busy} />
            <ListItem leading={<TableIcon />} primary={t('actions.migrateWrite')} secondary={t('actions.migrateWriteHint', { context })} onClick={() => void act('migrate-write')} disabled={busy} />
          </>
        )}
        {/* переключатель за замком; замок закрывается снова при уходе с вкладки */}
        <ListItem
          itemRole="checkbox"
          leading={<FileIcon />}
          primary={t('actions.guard')}
          secondary={t('actions.guardHint', { context })}
          selected={settings.guardOpenFiles}
          disabled={guardLocked}
          aside={
            <>
              <LockButton locked={guardLocked} label={guardLocked ? t('actions.guardUnlock') : t('actions.guardLock')} onToggle={() => setGuardLocked(!guardLocked)} />
              {/* переключатель справа от замка — отдельной кнопкой (строку тоже можно нажать) */}
              <button type="button" className="switch-btn" tabIndex={-1} aria-hidden="true" disabled={guardLocked} onClick={toggleGuard}>
                <Switch on={settings.guardOpenFiles} />
              </button>
            </>
          }
          onClick={toggleGuard}
        />
        {atelier && (
          <>
            <ListItem
              itemRole="checkbox"
              leading={<FactoryIcon />}
              primary={t('actions.autoProjects')}
              secondary={t('actions.autoProjectsHint')}
              selected={settings.autoProjects}
              trailing={<Switch on={settings.autoProjects} />}
              onClick={() => settingsStore.update({ autoProjects: !settings.autoProjects })}
            />
            <ListItem leading={<LinkIcon />} primary={t('actions.links')} secondary={t('actions.linksHint')} onClick={() => void api.open('links')} />
          </>
        )}
        <ListItem leading={<ResetIcon />} primary={t('actions.restore')} secondary={backups ? t('actions.restoreOpen') : t('actions.restoreHint')} expanded={!!backups} onClick={() => void (async () => setBackups(backups ? null : await api.backups()))()} disabled={busy} />
      </List>
      {backups &&
        (backups.length === 0 ? (
          <Notice>{t('actions.noBackups')}</Notice>
        ) : (
          <List label={t('actions.backups')} className="backup-list">
            {backups.map((b) => (
              <ListItem key={b} leading={<ClockIcon />} primary={b.startsWith('before-restore') ? t('actions.beforeRestore') : dateTime(stampTime(b))} secondary={b} onClick={() => void restore(b)} />
            ))}
          </List>
        ))}
    </FormSection>
  )
}

/** Язык, тема, автозапуск, трей. */
function SystemSection({ settings }: { settings: AppSettings }) {
  const { t } = useTranslation('settings')
  const toggle = (key: 'openAtLogin' | 'startMinimized' | 'trayMinimize') => settingsStore.update({ [key]: !settings[key] })
  return (
    <FormSection title={t('system.title')} icon={<SunIcon />}>
      <span className="form-section-hint">{t('system.language')}</span>
      <Tabs
        label={t('system.language')}
        value={settings.language}
        options={LANGUAGES.map((code) => {
          const { name, flag: Flag } = LANGUAGE_OPTIONS[code]
          return { value: code, label: name, icon: <Flag /> }
        })}
        onChange={(language) => settingsStore.update({ language })}
      />
      <span className="form-section-hint">{t('system.theme')}</span>
      <Tabs
        label={t('system.theme')}
        value={settings.theme}
        options={[
          { value: 'system', label: t('system.themeSystem'), icon: <MonitorIcon /> },
          { value: 'light', label: t('system.themeLight'), icon: <SunIcon /> },
          { value: 'dark', label: t('system.themeDark'), icon: <MoonIcon /> },
        ]}
        onChange={(theme) => settingsStore.update({ theme })}
      />
      <List label={t('system.title')}>
        <ListItem itemRole="checkbox" primary={t('system.login')} secondary={t('system.loginHint')} selected={settings.openAtLogin} trailing={<Switch on={settings.openAtLogin} />} onClick={() => toggle('openAtLogin')} />
        <ListItem itemRole="checkbox" primary={t('system.startMinimized')} secondary={t('system.startMinimizedHint')} selected={settings.startMinimized} trailing={<Switch on={settings.startMinimized} />} onClick={() => toggle('startMinimized')} />
        <ListItem itemRole="checkbox" primary={t('system.tray')} secondary={t('system.trayHint')} selected={settings.trayMinimize} trailing={<Switch on={settings.trayMinimize} />} onClick={() => toggle('trayMinimize')} />
      </List>
    </FormSection>
  )
}

/** Версия программы — в конце, как «О приложении» мобильного приложения. */
function AboutSection() {
  const { t } = useTranslation('settings')
  const info = useStore(appInfoStore)
  return (
    <FormSection title={t('about.title')} icon={<InfoIcon />}>
      <p className="app-version">{t('about.version', { version: info.version })}</p>
    </FormSection>
  )
}
