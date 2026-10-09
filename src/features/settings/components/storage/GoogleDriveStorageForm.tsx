import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GoogleLogo, LogoutIcon, PlugIcon, TableIcon } from '@/components/icons/Icons'
import { ActionButton } from '@/components/ui/ActionButton'
import { ActionTextInput } from '@/components/ui/ActionTextInput'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { FormSection } from '@/components/ui/FormSection'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { DriveClient } from '@/features/uploads/drive/DriveClient'
import { googleDriveSession } from '@/features/uploads/drive/GoogleDriveAuth'
import { toUploadError } from '@/features/uploads/UploadError'
import { useUploadErrorText } from '@/features/uploads/useUploadErrorText'
import { NativeDialogs } from '@/lib/platform/NativeDialogs'
import { settingsStore } from '../../store/SettingsStore'
import { useSettings } from '../../store/useSettings'
import { TableSheetField } from './TableSheetField'
import { useTableCheck } from './useTableCheck'
import { useTableLock } from './useTableLock'
import './StorageForms.css'

/**
 * Google Drive: вход через Google (нативный выбор аккаунта и согласие на доступ к Drive; после входа — почта
 * аккаунта, а справа в заголовке, напротив значка Google, — «Выйти»: отзывает доступ), таблица (папка и имя файла под замком, итог проверки, лист)
 * и «Проверить подключение».
 */
export function GoogleDriveStorageForm() {
  const { t } = useTranslation(['settings', 'common'])
  const { storage: { googleDrive } } = useSettings()
  const errorText = useUploadErrorText()
  const check = useTableCheck()
  const lock = useTableLock()
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

  return (
    <>
      <FormSection
        title={t('storage.googleDrive.account')}
        icon={<GoogleLogo />}
        // «Выйти» — «пилюля» как «Правка» в карточке результата: значок и подпись в одну строку.
        action={googleDrive.account ? (
          <ActionButton layout="inline" size={28} icon={<LogoutIcon />} caption={t('storage.googleDrive.signOut')} label={t('storage.googleDrive.signOutLabel')} onClick={() => void signOut()} />
        ) : undefined}
      >
        {googleDrive.account ? (
          <div className="storage-account">
            <StatusBadge tone="success">{t('storage.googleDrive.signedIn', { account: googleDrive.account })}</StatusBadge>
          </div>
        ) : (
          <Button variant="google" icon={<GoogleLogo />} busy={isSigningIn} onClick={() => void signIn()}>{t('storage.googleDrive.signIn')}</Button>
        )}
      </FormSection>

      <FormSection title={t('storage.googleDrive.location')} icon={<TableIcon />} hint={`${t('storage.googleDrive.locationHint')} ${t('storage.table.lockHint')} ${t('storage.sheet.hint')}`}>
        <Field label={t('storage.googleDrive.folder')}>
          <ActionTextInput
            inputMode="url"
            placeholder={t('storage.googleDrive.folderPlaceholder')}
            value={googleDrive.folder}
            onChange={(folder) => settingsStore.updateGoogleDrive({ folder })}
            locked={lock.locked}
            action={lock.action}
          />
        </Field>
        <Field label={t('storage.googleDrive.fileName')}>
          <ActionTextInput
            value={googleDrive.fileName}
            onChange={(fileName) => settingsStore.updateGoogleDrive({ fileName })}
            locked={lock.locked}
            action={[lock.action, check.action]}
          />
        </Field>
        {googleDrive.account && <div className="storage-check" role="status">{check.status}</div>}
        <TableSheetField />
      </FormSection>

      <Button variant="tonal" icon={<PlugIcon />} busy={check.isTesting} disabled={check.isChecking || !googleDrive.account} onClick={() => void check.testConnection()}>
        {check.isTesting ? t('storage.smb.testing') : t('storage.smb.test')}
      </Button>
    </>
  )
}
