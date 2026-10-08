import type { ReactNode } from 'react'
import { TextInput, type TextInputProps } from './TextInput'
import './TextInput.css'

/** Кнопка-значок внутри поля. */
export interface InputAction {
  /** Значок. */
  icon: ReactNode
  /** Доступное имя кнопки. */
  label: string
  /** Нажатие. */
  onClick: () => void
  /** Идёт действие: вместо значка крутится спиннер, кнопка недоступна. */
  busy?: boolean
  /** Кнопка недоступна. */
  disabled?: boolean
  /** Цвет значка — итог действия: успех или ошибка; по умолчанию — цвет второстепенного текста. */
  tone?: 'success' | 'danger'
}

/** Свойства `ActionTextInput`. */
export interface ActionTextInputProps extends TextInputProps {
  /** Кнопка справа внутри поля. */
  action: InputAction
}

/**
 * Текстовое поле с кнопкой-значком справа внутри поля — как глазок у `SecretInput`
 * (тот же вид и отклик на касание: волна на Android, приглушение на iOS).
 */
export function ActionTextInput({ action, ...inputProps }: ActionTextInputProps) {
  const { icon, label, onClick, busy = false, disabled = false, tone } = action
  return (
    <div className="input-with-action">
      <TextInput {...inputProps} />
      <button
        type="button"
        className={`input-action${busy ? ' is-busy' : ''}${tone ? ` is-${tone}` : ''}`}
        aria-label={label}
        aria-busy={busy || undefined}
        disabled={disabled || busy}
        onClick={(event) => {
          // Поле обычно внутри `<label>` (Field): без этого касание кнопки ставило бы фокус в поле
          // и открывало клавиатуру.
          event.preventDefault()
          onClick()
        }}
      >
        {busy ? <span className="input-action-spinner" /> : icon}
      </button>
    </div>
  )
}
