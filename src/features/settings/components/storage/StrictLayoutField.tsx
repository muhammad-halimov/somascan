import { useTranslation } from 'react-i18next'
import { CheckIcon } from '@/components/icons/Icons'
import { List, ListItem } from '@/components/ui/List'
import { settingsStore } from '../../store/SettingsStore'
import { useSettings } from '../../store/useSettings'

/**
 * «Строгое строение таблицы» (по умолчанию включено): запись идёт только в лист со всеми колонками
 * журнала по порядку (`strictMismatch`); итог проверки таблицы показывает, что не так.
 */
export function StrictLayoutField() {
  const { t } = useTranslation('settings')
  const { storage } = useSettings()
  return (
    <List label={t('storage.strict.label')}>
      <ListItem
        itemRole="checkbox"
        primary={t('storage.strict.label')}
        secondary={t('storage.strict.hint')}
        selected={storage.strictLayout}
        trailing={storage.strictLayout ? <CheckIcon /> : undefined}
        onClick={() => settingsStore.setStrictLayout(!storage.strictLayout)}
      />
    </List>
  )
}
