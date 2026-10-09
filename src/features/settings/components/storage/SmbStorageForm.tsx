import { useTranslation } from 'react-i18next'
import { FolderIcon, PlugIcon, UserIcon } from '@/components/icons/Icons'
import { ActionTextInput } from '@/components/ui/ActionTextInput'
import { Button } from '@/components/ui/Button'
import { Field, FieldRow } from '@/components/ui/Field'
import { FormSection } from '@/components/ui/FormSection'
import { SecretInput } from '@/components/ui/SecretInput'
import { TextInput } from '@/components/ui/TextInput'
import { settingsStore } from '../../store/SettingsStore'
import { useSettings } from '../../store/useSettings'
import { TableSheetField } from './TableSheetField'
import { useTableCheck } from './useTableCheck'
import { useTableLock } from './useTableLock'
import './StorageForms.css'

/**
 * Сетевой диск Windows: расположение (сервер, общая папка, путь к таблице под замком, итог проверки,
 * лист, короткое пояснение под ними), учётная запись и «Проверить подключение».
 */
export function SmbStorageForm() {
  const { t } = useTranslation('settings')
  const { storage: { smb } } = useSettings()
  const check = useTableCheck()
  const lock = useTableLock()

  return (
    <>
      <FormSection title={t('storage.smb.location')} icon={<FolderIcon />} hint={`${t('storage.smb.filePathHint')} ${t('storage.table.lockHint')} ${t('storage.sheet.hint')}`}>
        <Field label={t('storage.smb.server')}>
          <TextInput inputMode="url" placeholder={t('storage.smb.serverPlaceholder')} value={smb.host} onChange={(host) => settingsStore.updateSmb({ host })} />
        </Field>
        <Field label={t('storage.smb.share')}>
          <TextInput placeholder={t('storage.smb.sharePlaceholder')} value={smb.share} onChange={(share) => settingsStore.updateSmb({ share })} />
        </Field>
        <Field label={t('storage.smb.filePath')}>
          <ActionTextInput
            placeholder={t('storage.smb.filePathPlaceholder')}
            value={smb.filePath}
            onChange={(filePath) => settingsStore.updateSmb({ filePath })}
            locked={lock.locked}
            action={[lock.action, check.action]}
          />
        </Field>
        <div className="storage-check" role="status">{check.status}</div>
        <TableSheetField />
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

      <Button variant="tonal" icon={<PlugIcon />} busy={check.isTesting} disabled={check.isChecking} onClick={() => void check.testConnection()}>
        {check.isTesting ? t('storage.smb.testing') : t('storage.smb.test')}
      </Button>
    </>
  )
}
