/**
 * Поля ввода: текст, текст с кнопками-значками внутри (замок, папка), секрет с «глазком», выбор из списка.
 * Все сообщают обычные значения вместо событий.
 */
import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type SelectHTMLAttributes } from 'react'
import { ArrowDropDownIcon, EyeIcon, EyeOffIcon } from '@/components/icons/Icons'
import './Inputs.css'

/** Свойства `TextInput`. */
export interface TextInputProps extends Omit<ComponentProps<'input'>, 'onChange' | 'value'> {
  value: string
  onChange: (value: string) => void
}

/** Однострочное текстовое поле: без автозамены и автозаглавных, Enter убирает фокус. */
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
      {...rest}
    />
  )
}

/** Кнопка-значок внутри поля. */
export interface InputAction {
  icon: ReactNode
  /** Доступное имя кнопки. */
  label: string
  onClick: () => void
  /** Идёт действие: вместо значка спиннер, кнопка недоступна. */
  busy?: boolean
  disabled?: boolean
  /** Цвет значка: итог действия или включённое состояние (открытый замок). */
  tone?: 'success' | 'danger' | 'accent'
}

/** Свойства `ActionTextInput`. */
export interface ActionTextInputProps extends TextInputProps {
  /** Кнопки справа внутри поля, слева направо. */
  action: InputAction | readonly InputAction[]
  /** Поле закрыто для правки (замок): текст приглушён. */
  locked?: boolean
}

/** Кнопки-значки справа внутри поля. */
function InputActions({ actions }: { actions: readonly InputAction[] }) {
  return (
    <div className="input-actions">
      {actions.map(({ icon, label, onClick, busy = false, disabled = false, tone }) => (
        <button
          key={label}
          type="button"
          className={`input-action${busy ? ' is-busy' : ''}${tone ? ` is-${tone}` : ''}`}
          aria-label={label}
          title={label}
          aria-busy={busy || undefined}
          disabled={disabled || busy}
          onClick={(event) => {
            // поле обычно внутри `<label>` (Field): без этого нажатие ставило бы фокус в поле
            event.preventDefault()
            onClick()
          }}
        >
          {busy ? <span className="input-action-spinner" /> : icon}
        </button>
      ))}
    </div>
  )
}

/** Текстовое поле с кнопками-значками справа внутри. */
export function ActionTextInput({ action, locked = false, className = '', ...inputProps }: ActionTextInputProps) {
  const actions = Array.isArray(action) ? action : [action as InputAction]
  return (
    <div className={`input-with-action${actions.length > 1 ? ` has-actions-${actions.length}` : ''}`}>
      <TextInput {...inputProps} readOnly={locked || inputProps.readOnly} className={`${className}${locked ? ' is-locked' : ''}`.trim()} />
      <InputActions actions={actions} />
    </div>
  )
}

/** Свойства `SecretInput`. */
export interface SecretInputProps extends Omit<TextInputProps, 'type'> {
  /** Подписи «глазка». */
  showLabel: string
  hideLabel: string
  /**
   * В поле только маска (сам секрет хранится не в окне): вызывается, когда секрет нужен — показать или
   * править, — и подставляет его в `value`.
   */
  onReveal?: () => Promise<void>
}

/** Поле пароля: по умолчанию скрыто, «глазок» показывает значение. */
export function SecretInput({ showLabel, hideLabel, onReveal, className = '', onFocus, ...inputProps }: SecretInputProps) {
  const [visible, setVisible] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Положение каретки на момент переключения: смена `type` сбрасывает его. */
  const selection = useRef<[number | null, number | null] | null>(null)
  const load = async () => {
    if (onReveal) await onReveal()
  }

  const toggle = async () => {
    const input = inputRef.current
    selection.current = input && document.activeElement === input ? [input.selectionStart, input.selectionEnd] : null
    if (!visible) await load()
    setVisible((v) => !v)
  }

  useLayoutEffect(() => {
    const input = inputRef.current
    const saved = selection.current
    selection.current = null
    if (!input || !saved || document.activeElement !== input) return
    input.setSelectionRange(saved[0], saved[1])
  }, [visible])

  return (
    <div className="input-with-action">
      <TextInput
        {...inputProps}
        ref={inputRef}
        className={className}
        type={visible ? 'text' : 'password'}
        onFocus={(e) => {
          onFocus?.(e)
          void load()
        }}
      />
      <InputActions actions={[{ icon: visible ? <EyeOffIcon /> : <EyeIcon />, label: visible ? hideLabel : showLabel, onClick: () => void toggle() }]} />
    </div>
  )
}

/** Вариант выбора. */
export interface SelectOption {
  value: string
  label: string
}

/** Свойства `SelectInput`. */
export interface SelectInputProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
}

/** Системный выбор (`<select>`) в виде поля ввода. */
export function SelectInput({ value, options, onChange, className = '', ...rest }: SelectInputProps) {
  return (
    <div className="select-input-wrap">
      <select {...rest} className={`text-input select-input${className ? ` ${className}` : ''}`} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <span className="select-input-icon" aria-hidden="true">
        <ArrowDropDownIcon />
      </span>
    </div>
  )
}
