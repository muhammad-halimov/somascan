import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'
import { DatabaseIcon, FolderIcon, GoogleDriveLogo, GoogleLogo, PlugIcon, TableIcon, UserIcon, WindowsLogo } from '@/components/icons/Icons'
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
import { toUploadError } from '@/features/uploads/UploadError'
import { useUploadErrorText } from '@/features/uploads/useUploadErrorText'
import { uploadWorker } from '@/features/uploads/worker/UploadWorker'
import { BACKUP_RETENTION_DAYS } from '@/features/uploads/xlsx/BackupPolicy'
import { settingsStore } from '../store/SettingsStore'
import { STORAGE_TARGETS } from '../store/settingsSchema'
import { useSettings } from '../store/useSettings'
import './StorageTab.css'

/**
 * Вкладка «Хранилище»: куда дописываются строки `.xlsx` с распознанными бирками —
 * сетевой диск Windows (SMB) или Google Drive.
 *
 * «Проверить подключение» подключается с введёнными данными и сообщает, найдена ли таблица.
 * Google Drive: вход через Google (нативный выбор аккаунта и согласие на доступ к Drive),
 * почта аккаунта показывается под кнопкой; «Выйти» отзывает доступ.
 */
export function StorageTab() {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const { storage } = useSettings()
  const { smb, googleDrive } = storage
  const errorText = useUploadErrorText()
  const [isTesting, setIsTesting] = useState(false)

  const [isSigningIn, setIsSigningIn] = useState(false)

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

  /** Подключается к хранилищу с текущими настройками и показывает результат. */
  const testConnection = async () => {
    setIsTesting(true)
    try {
      const result = await uploadWorker.testConnection()
      const message = result.exists
        ? t('storage.smb.testOkExisting', {
            size: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(Math.max(1, result.size / 1024)),
            date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(result.modifiedAt),
          })
        : t('storage.smb.testOkNew')
      await NativeDialogs.alert({ title: t('storage.smb.testOkTitle'), message, buttonTitle: t('common:ok') })
    } catch (error) {
      await NativeDialogs.alert({ title: t('storage.smb.testFailedTitle'), message: errorText(toUploadError(error)), buttonTitle: t('common:ok') })
    } finally {
      setIsTesting(false)
    }
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
            <FormSection title={t('storage.smb.location')} icon={<FolderIcon />} hint={t('storage.smb.filePathHint')}>
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
                <TextInput placeholder={t('storage.smb.filePathPlaceholder')} value={smb.filePath} onChange={(filePath) => settingsStore.updateSmb({ filePath })} />
              </Field>
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

            <Button variant="tonal" icon={<PlugIcon />} busy={isTesting} onClick={() => void testConnection()}>
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

            <FormSection title={t('storage.googleDrive.location')} icon={<TableIcon />} hint={t('storage.googleDrive.locationHint')}>
              <Field label={t('storage.googleDrive.folder')}>
                <TextInput
                  inputMode="url"
                  placeholder={t('storage.googleDrive.folderPlaceholder')}
                  value={googleDrive.folder}
                  onChange={(folder) => settingsStore.updateGoogleDrive({ folder })}
                />
              </Field>
              <Field label={t('storage.googleDrive.fileName')}>
                <TextInput value={googleDrive.fileName} onChange={(fileName) => settingsStore.updateGoogleDrive({ fileName })} />
              </Field>
            </FormSection>

            <Button variant="tonal" icon={<PlugIcon />} busy={isTesting} disabled={!googleDrive.account} onClick={() => void testConnection()}>
              {isTesting ? t('storage.smb.testing') : t('storage.smb.test')}
            </Button>
          </>
        )}
      </div>
    </>
  )
}
