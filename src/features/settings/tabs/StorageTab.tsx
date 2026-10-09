import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'
import { DatabaseIcon, FolderIcon, GoogleDriveLogo, GoogleLogo, LockIcon, LockOpenIcon, PlugIcon, TableIcon, TableSearchIcon, UserIcon, WindowsLogo } from '@/components/icons/Icons'
import { ActionTextInput, type InputAction } from '@/components/ui/ActionTextInput'
import { Button } from '@/components/ui/Button'
import { Field, FieldRow } from '@/components/ui/Field'
import { FormSection } from '@/components/ui/FormSection'
import { Notice } from '@/components/ui/Notice'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SecretInput } from '@/components/ui/SecretInput'
import { Tabs } from '@/components/ui/Tabs'
import { TextInput } from '@/components/ui/TextInput'
import { DriveClient } from '@/features/uploads/drive/DriveClient'
import { googleDriveSession } from '@/features/uploads/drive/GoogleDriveAuth'
import { tableCheckStore, type TableCheckResult } from '@/features/uploads/store/TableCheckStore'
import { toUploadError } from '@/features/uploads/UploadError'
import { useUploadErrorText } from '@/features/uploads/useUploadErrorText'
import { BACKUP_RETENTION_DAYS } from '@/features/uploads/xlsx/BackupPolicy'
import { useStore } from '@/lib/store/useStore'
import { settingsStore } from '../store/SettingsStore'
import { STORAGE_TARGETS } from '../store/settingsSchema'
import { useSettings } from '../store/useSettings'
import './StorageTab.css'

/**
 * Вкладка «Хранилище»: куда дописываются строки `.xlsx` с распознанными бирками —
 * сетевой диск Windows (SMB) или Google Drive.
 *
 * Таблица должна уже существовать: приложение её не создаёт, без неё запись невозможна.
 * Путь и имя таблицы — под замком (по умолчанию «Probe otel.xlsx», см. `DEFAULT_TABLE_FILE`): поля
 * закрыты для правки, чтобы их не сбили случайно; замок в поле открывает их до закрытия настроек.
 * Значок сверки в конце поля пути к таблице (у Google Drive — имени файла) сверяет, есть ли таблица,
 * и оставляет итог под полями;
 * «Проверить подключение» делает ту же проверку и сообщает итог диалогом.
 * Google Drive: вход через Google (нативный выбор аккаунта и согласие на доступ к Drive),
 * почта аккаунта показывается под кнопкой; «Выйти» отзывает доступ.
 */
export function StorageTab() {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const { storage } = useSettings()
  const { smb, googleDrive } = storage
  const errorText = useUploadErrorText()
  const check = useStore(tableCheckStore)
  /** Идёт проверка от «Проверить подключение» (а не от значка сверки в поле). */
  const [isTesting, setIsTesting] = useState(false)
  /** Проверять есть что: у Google Drive — только после входа. */
  const canCheck = storage.target === 'smb' || Boolean(googleDrive.account)

  const [isSigningIn, setIsSigningIn] = useState(false)
  /** Замок пути и имени таблицы открыт: поля можно править (при каждом открытии настроек — снова закрыт). */
  const [isTableUnlocked, setIsTableUnlocked] = useState(false)
  const lockAction: InputAction = {
    icon: isTableUnlocked ? <LockOpenIcon /> : <LockIcon />,
    label: isTableUnlocked ? t('storage.table.lock') : t('storage.table.unlock'),
    tone: isTableUnlocked ? 'accent' : undefined,
    onClick: () => setIsTableUnlocked((unlocked) => !unlocked),
  }

  /** Вход через Google: токен с доступом к Drive, почта аккаунта — в настройки. */
  const signIn = async () => {
    setIsSigningIn(true)
    try {
      const token = await googleDriveSession.signIn()
      const account = await new DriveClient(token).userEmail()
      settingsStore.updateGoogleDrive({ account: account || t('storage.googleDrive.accountUnknown') })
    } catch (error) {
      const failure = toUploadError(error)
      if (failure.code !== 'cancelled') {
        await NativeDialogs.alert({ title: t('storage.googleDrive.signInFailed'), message: errorText(failure), buttonTitle: t('common:ok') })
      }
    } finally {
      setIsSigningIn(false)
    }
  }

  /** Выход: доступ отзывается, в настройках остаются папка и имя файла. */
  const signOut = async () => {
    const confirmed = await NativeDialogs.confirm({
      title: t('storage.googleDrive.signOutTitle'),
      message: t('storage.googleDrive.signOutMessage', { account: googleDrive.account }),
      okButtonTitle: t('storage.googleDrive.signOut'),
      cancelButtonTitle: t('common:cancel'),
    })
    if (!confirmed) return
    await googleDriveSession.signOut(googleDrive.account)
    settingsStore.updateGoogleDrive({ account: '' })
  }

  /** Подключается к хранилищу с текущими настройками и показывает итог диалогом. */
  const testConnection = async () => {
    setIsTesting(true)
    try {
      const result = await tableCheckStore.check()
      if (result.kind === 'found') {
        await NativeDialogs.alert({ title: t('storage.smb.testOkTitle'), message: foundText(result), buttonTitle: t('common:ok') })
      } else if (result.kind === 'missing') {
        await NativeDialogs.alert({ title: t('storage.smb.testMissingTitle'), message: t('storage.smb.testMissingMessage'), buttonTitle: t('common:ok') })
      } else {
        await NativeDialogs.alert({ title: t('storage.smb.testFailedTitle'), message: errorText(result.error), buttonTitle: t('common:ok') })
      }
    } finally {
      setIsTesting(false)
    }
  }

  /** «Таблица найдена: 24 КБ, изменена …». */
  const foundText = (result: Extract<TableCheckResult, { kind: 'found' }>) => t('storage.smb.testOkExisting', {
    size: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(Math.max(1, result.size / 1024)),
    date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(result.modifiedAt),
  })

  /** Значок сверки в конце поля таблицы: цвет — итог проверки, сам итог — строкой под полями. */
  const checkResult = tableCheckStore.resultFor(storage)
  const checkAction: InputAction = {
    icon: <TableSearchIcon />,
    label: t('storage.check.label'),
    busy: check.checking && !isTesting,
    disabled: check.checking || !canCheck,
    tone: checkResult ? (checkResult.kind === 'found' ? 'success' : 'danger') : undefined,
    onClick: () => void tableCheckStore.check(),
  }

  /** Итог проверки текущих настроек: найдена, не найдена (писать некуда), не проверена. */
  const checkStatus = () => {
    if (check.storage === storage && check.checking) return <StatusBadge tone="neutral">{t('storage.check.checking')}</StatusBadge>
    if (!checkResult) return <StatusBadge tone="neutral">{t('storage.check.unchecked')}</StatusBadge>
    if (checkResult.kind === 'found') return <StatusBadge tone="success">{foundText(checkResult)}</StatusBadge>
    if (checkResult.kind === 'missing') return <StatusBadge tone="danger">{t('storage.check.missing')}</StatusBadge>
    return <StatusBadge tone="danger">{t('storage.check.failed', { error: errorText(checkResult.error) })}</StatusBadge>
  }

  return (
    <>
      <Notice>{t('storage.intro')} {t('storage.backups', { days: BACKUP_RETENTION_DAYS })}</Notice>

      <FormSection title={t('storage.target')} icon={<DatabaseIcon />}>
        <Tabs
          label={t('storage.target')}
          value={storage.target}
          options={STORAGE_TARGETS.map((target) => ({
            value: target,
            label: t(`storage.targets.${target}`),
            icon: target === 'smb' ? <WindowsLogo /> : <GoogleDriveLogo />,
          }))}
          onChange={(target) => settingsStore.setStorageTarget(target)}
        />
      </FormSection>

      {/* `key` по месту хранения: при переключении форма появляется анимацией. */}
      <div key={storage.target} className="settings-stack anim-enter">
        {storage.target === 'smb' ? (
          <>
            <FormSection title={t('storage.smb.location')} icon={<FolderIcon />} hint={`${t('storage.smb.filePathHint')} ${t('storage.table.lockHint')}`}>
              <Field label={t('storage.smb.server')}>
                <TextInput
                  inputMode="url"
                  placeholder={t('storage.smb.serverPlaceholder')}
                  value={smb.host}
                  onChange={(host) => settingsStore.updateSmb({ host })}
                />
              </Field>
              <Field label={t('storage.smb.share')}>
                <TextInput placeholder={t('storage.smb.sharePlaceholder')} value={smb.share} onChange={(share) => settingsStore.updateSmb({ share })} />
              </Field>
              <Field label={t('storage.smb.filePath')}>
                <ActionTextInput
                  placeholder={t('storage.smb.filePathPlaceholder')}
                  value={smb.filePath}
                  onChange={(filePath) => settingsStore.updateSmb({ filePath })}
                  locked={!isTableUnlocked}
                  action={[lockAction, checkAction]}
                />
              </Field>
              <div className="storage-check" role="status">{checkStatus()}</div>
            </FormSection>

            <FormSection title={t('storage.smb.account')} icon={<UserIcon />}>
              <FieldRow>
                <Field label={t('storage.smb.domain')}>
                  <TextInput placeholder={t('storage.smb.domainPlaceholder')} value={smb.domain} onChange={(domain) => settingsStore.updateSmb({ domain })} />
                </Field>
                <Field label={t('storage.smb.username')}>
                  <TextInput autoComplete="username" value={smb.username} onChange={(username) => settingsStore.updateSmb({ username })} />
                </Field>
              </FieldRow>
              <Field label={t('storage.smb.password')}>
                <SecretInput
                  kind="password"
                  autoComplete="current-password"
                  value={smb.password}
                  onChange={(password) => settingsStore.updateSmb({ password })}
                  showLabel={t('storage.smb.showPassword')}
                  hideLabel={t('storage.smb.hidePassword')}
                />
              </Field>
            </FormSection>

            <Button variant="tonal" icon={<PlugIcon />} busy={isTesting} disabled={check.checking} onClick={() => void testConnection()}>
              {isTesting ? t('storage.smb.testing') : t('storage.smb.test')}
            </Button>
          </>
        ) : (
          <>
            <FormSection title={t('storage.googleDrive.account')} icon={<GoogleLogo />}>
              {googleDrive.account ? (
                <div className="storage-account">
                  <StatusBadge tone="success">{t('storage.googleDrive.signedIn', { account: googleDrive.account })}</StatusBadge>
                  <Button onClick={() => void signOut()}>{t('storage.googleDrive.signOut')}</Button>
                </div>
              ) : (
                <Button variant="google" icon={<GoogleLogo />} busy={isSigningIn} onClick={() => void signIn()}>{t('storage.googleDrive.signIn')}</Button>
              )}
            </FormSection>

            <FormSection title={t('storage.googleDrive.location')} icon={<TableIcon />}>
              <Field label={t('storage.googleDrive.folder')}>
                <ActionTextInput
                  inputMode="url"
                  placeholder={t('storage.googleDrive.folderPlaceholder')}
                  value={googleDrive.folder}
                  onChange={(folder) => settingsStore.updateGoogleDrive({ folder })}
                  locked={!isTableUnlocked}
                  action={lockAction}
                />
              </Field>
              <Field label={t('storage.googleDrive.fileName')}>
                <ActionTextInput
                  value={googleDrive.fileName}
                  onChange={(fileName) => settingsStore.updateGoogleDrive({ fileName })}
                  locked={!isTableUnlocked}
                  action={[lockAction, checkAction]}
                />
              </Field>
              {googleDrive.account && <div className="storage-check" role="status">{checkStatus()}</div>}
              <Notice>{t('storage.googleDrive.locationHint')} {t('storage.table.lockHint')}</Notice>
            </FormSection>

            <Button variant="tonal" icon={<PlugIcon />} busy={isTesting} disabled={check.checking || !googleDrive.account} onClick={() => void testConnection()}>
              {isTesting ? t('storage.smb.testing') : t('storage.smb.test')}
            </Button>
          </>
        )}
      </div>
    </>
  )
}
