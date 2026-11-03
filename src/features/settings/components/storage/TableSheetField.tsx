import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon } from '@/components/icons/Icons'
import { Disclosure } from '@/components/ui/Disclosure'
import { Field } from '@/components/ui/Field'
import { List, ListItem } from '@/components/ui/List'
import { tableCheckStore } from '@/features/uploads/store/TableCheckStore'
import { useOrderOnOpen } from '@/hooks/useOrderOnOpen'
import { useStore } from '@/lib/store/useStore'
import { settingsStore } from '../../store/SettingsStore'
import { useSettings } from '../../store/useSettings'

/**
 * Лист журнала, куда пишутся бирки: лист текущего года (по умолчанию) или лист таблицы. Листы — из последней
 * проверки таблицы (`TableCheckStore`); выбранный, но не найденный в таблице — с пометкой.
 * Выбор — шторкой, как остальные списки настроек и выбор листа в карточке бирки: в заголовке выбранный лист,
 * по нажатию ниже раскрывается список с галочкой у выбранного, выбор сворачивает его. Выбранный — первым
 * (порядок берётся при раскрытии, `useOrderOnOpen`: выбор ничего не переставляет под пальцем).
 */
export function TableSheetField() {
  const { t } = useTranslation('settings')
  const { storage } = useSettings()
  useStore(tableCheckStore)
  const [isOpen, setIsOpen] = useState(false)
  const names = tableCheckStore.sheetsFor(storage)
  const options = [
    { value: '', label: t('storage.sheet.auto', { year: new Date().getFullYear() }) },
    ...names.map((name) => ({ value: name, label: name })),
    ...(storage.sheet && !names.includes(storage.sheet) ? [{ value: storage.sheet, label: t('storage.sheet.unknown', { sheet: storage.sheet }) }] : []),
  ]
  const isSelected = (option: { value: string }) => option.value === storage.sheet
  const { ordered, freeze } = useOrderOnOpen(options, isSelected, (option) => option.value)
  const current = options.find(isSelected) ?? options[0]!
  const label = t('storage.sheet.label')

  const toggle = () => {
    if (!isOpen) freeze()
    setIsOpen(!isOpen)
  }
  const pick = (sheet: string) => {
    settingsStore.setTableSheet(sheet)
    setIsOpen(false)
  }

  return (
    <Field label={label} group>
      <Disclosure open={isOpen} onToggle={toggle} summary={current.label}>
        <List role="radiogroup" label={label}>
          {ordered.map((option) => {
            const selected = isSelected(option)
            return (
              <ListItem
                key={option.value}
                itemRole="radio"
                primary={option.label}
                selected={selected}
                trailing={selected ? <CheckIcon /> : undefined}
                onClick={() => pick(option.value)}
              />
            )
          })}
        </List>
      </Disclosure>
    </Field>
  )
}
