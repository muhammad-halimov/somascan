import type { SelectHTMLAttributes } from 'react'
import { ArrowDropDownIcon, ChevronUpDownIcon } from '@/components/icons/Icons'
import './TextInput.css'

/** Вариант выбора. */
export interface SelectOption {
  /** Значение. */
  value: string
  /** Подпись. */
  label: string
}

/** Свойства `SelectInput`. */
export interface SelectInputProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  /** Выбранное значение. */
  value: string
  /** Варианты. */
  options: readonly SelectOption[]
  /** Выбрано новое значение. */
  onChange: (value: string) => void
}

/**
 * Системный выбор (`<select>`: список на Android, меню на iOS) в виде поля ввода — та же заливка и линия,
 * что у `TextInput`, справа значок выпадающего списка по платформе (Material — треугольник, iOS — двойной уголок).
 */
export function SelectInput({ value, options, onChange, className = '', ...rest }: SelectInputProps) {
  return (
    <div className="select-input-wrap">
      <select {...rest} className={`text-input select-input${className ? ` ${className}` : ''}`} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <span className="select-input-icon" aria-hidden="true">
        <ChevronUpDownIcon />
        <ArrowDropDownIcon />
      </span>
    </div>
  )
}
