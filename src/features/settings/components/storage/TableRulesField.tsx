import { useTranslation } from 'react-i18next'
import { CheckIcon } from '@/components/icons/Icons'
import { List, ListItem } from '@/components/ui/List'
import { settingsStore } from '../../store/SettingsStore'
import { useSettings } from '../../store/useSettings'
import { useTableLock } from './useTableLock'

/**
 * Правила записи в журнал (оба по умолчанию включены):
 * - «Строгое строение таблицы» — запись идёт только в лист со всеми колонками журнала по порядку
 *   (`strictMismatch`); итог проверки таблицы показывает, что не так;
 * - «Каждая плавка — один раз» — плавка, которая уже есть в журнале, в «Загрузках» или у другой бирки
 *   на экране, не отправляется и не записывается. Под замком, как путь к таблице: его не выключат случайно;
 *   замок справа открывает переключатель, пока форма на экране.
 */
export function TableRulesField() {
  const { t } = useTranslation('settings')
  const { storage } = useSettings()
  const heatLock = useTableLock({ lock: t('storage.uniqueHeat.lock'), unlock: t('storage.uniqueHeat.unlock') })
  const { icon, label, tone, onClick } = heatLock.action
  return (
    <List label={t('storage.rules')}>
      <ListItem
        itemRole="checkbox"
        primary={t('storage.strict.label')}
        secondary={t('storage.strict.hint')}
        selected={storage.strictLayout}
        trailing={storage.strictLayout ? <CheckIcon /> : undefined}
        onClick={() => settingsStore.setStrictLayout(!storage.strictLayout)}
      />
      <ListItem
        itemRole="checkbox"
        className={heatLock.locked ? 'is-locked' : undefined}
        primary={t('storage.uniqueHeat.label')}
        secondary={t('storage.uniqueHeat.hint')}
        selected={storage.uniqueHeat}
        disabled={heatLock.locked}
        trailing={storage.uniqueHeat ? <CheckIcon /> : undefined}
        onClick={() => settingsStore.setUniqueHeat(!storage.uniqueHeat)}
        action={(
          <button type="button" className={`input-action${tone ? ` is-${tone}` : ''}`} aria-label={label} onClick={onClick}>
            {icon}
          </button>
        )}
      />
    </List>
  )
}
