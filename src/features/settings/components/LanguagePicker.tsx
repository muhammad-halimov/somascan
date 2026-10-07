import { Tabs } from '@/components/ui/Tabs'
import { LANGUAGE_OPTIONS, type Language } from '@/i18n/languages'

/** Свойства `LanguagePicker`. */
export interface LanguagePickerProps {
  /** Выбранный язык. */
  value: Language
  /** Вызывается с выбранным языком. */
  onChange: (language: Language) => void
  /** Доступное имя группы. */
  label: string
}

/**
 * Выбор языка интерфейса — вкладки с флагом над названием.
 * Название на самом языке, чтобы его узнали при любом текущем языке интерфейса.
 */
export function LanguagePicker({ value, onChange, label }: LanguagePickerProps) {
  return (
    <Tabs
      label={label}
      value={value}
      options={LANGUAGE_OPTIONS.map((option) => ({ value: option.code, label: option.nativeName, icon: option.flag }))}
      onChange={onChange}
    />
  )
}
