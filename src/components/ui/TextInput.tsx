import type { ComponentProps } from 'react'
import './TextInput.css'

/** Свойства `TextInput`. */
export interface TextInputProps extends Omit<ComponentProps<'input'>, 'onChange' | 'value'> {
  /** Текущий текст. */
  value: string
  /** Вызывается с новым текстом при каждом изменении. */
  onChange: (value: string) => void
}

/**
 * Однострочное текстовое поле; сообщает обычные строки вместо событий.
 * Клавиатура как у нативного поля: без автозамены и автозаглавных, клавиша «Готово» убирает клавиатуру.
 */
export function TextInput({ value, onChange, className = '', onKeyDown, ...rest }: TextInputProps) {
  return (
    <input
      type="text"
      className={`text-input${className ? ` ${className}` : ''}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (event.key === 'Enter' && !event.defaultPrevented) event.currentTarget.blur()
      }}
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="done"
      {...rest}
    />
  )
}
