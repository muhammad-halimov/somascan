import { useTranslation } from 'react-i18next'
import { DatabaseIcon, GoogleDriveLogo, WindowsLogo } from '@/components/icons/Icons'
import { FormSection } from '@/components/ui/FormSection'
import { Notice } from '@/components/ui/Notice'
import { Tabs } from '@/components/ui/Tabs'
import { BACKUP_RETENTION_DAYS } from '@/features/uploads/xlsx/BackupPolicy'
import { GoogleDriveStorageForm } from '../components/storage/GoogleDriveStorageForm'
import { SmbStorageForm } from '../components/storage/SmbStorageForm'
import { settingsStore } from '../store/SettingsStore'
import { STORAGE_TARGETS } from '../store/settingsSchema'
import { useSettings } from '../store/useSettings'

/**
 * Вкладка «Хранилище»: куда дописываются строки `.xlsx` с распознанными бирками —
 * сетевой диск Windows (SMB, `SmbStorageForm`) или Google Drive (`GoogleDriveStorageForm`).
 *
 * Таблица должна уже существовать: приложение её не создаёт, без неё запись невозможна.
 * В обеих формах путь и имя таблицы — под замком (`useTableLock`; по умолчанию «Probe otel.xlsx»,
 * см. `DEFAULT_TABLE_FILE`), значок сверки в конце поля проверяет, есть ли таблица (`useTableCheck`), итог —
 * строкой под полями, а под ней — выбор листа (`TableSheetField`); «Проверить подключение» — та же
 * проверка с итогом в диалоге.
 */
export function StorageTab() {
  const { t } = useTranslation('settings')
  const { storage } = useSettings()

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
        {storage.target === 'smb' ? <SmbStorageForm /> : <GoogleDriveStorageForm />}
      </div>
    </>
  )
}
