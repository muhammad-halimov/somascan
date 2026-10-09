import { useTranslation } from 'react-i18next'
import { Field } from '@/components/ui/Field'
import { SelectInput } from '@/components/ui/SelectInput'
import { tableCheckStore } from '@/features/uploads/store/TableCheckStore'
import { useStore } from '@/lib/store/useStore'
import { settingsStore } from '../../store/SettingsStore'
import { useSettings } from '../../store/useSettings'

/**
 * Лист журнала, куда пишутся бирки: лист текущего года (по умолчанию) или лист таблицы. Листы — из последней
 * проверки таблицы (`TableCheckStore`); выбранный, но не найденный в таблице — с пометкой. Пояснение
 * (`storage.sheet.hint`) — в общей подсказке группы таблицы.
 */
export function TableSheetField() {
  const { t } = useTranslation('settings')
  const { storage } = useSettings()
  useStore(tableCheckStore)
  const names = tableCheckStore.sheetsFor(storage)
  const options = [
    { value: '', label: t('storage.sheet.auto', { year: new Date().getFullYear() }) },
    ...names.map((name) => ({ value: name, label: name })),
    ...(storage.sheet && !names.includes(storage.sheet) ? [{ value: storage.sheet, label: t('storage.sheet.unknown', { sheet: storage.sheet }) }] : []),
  ]
  return (
    <Field label={t('storage.sheet.label')}>
      <SelectInput value={storage.sheet} options={options} onChange={(sheet) => settingsStore.setTableSheet(sheet)} />
    </Field>
  )
}
