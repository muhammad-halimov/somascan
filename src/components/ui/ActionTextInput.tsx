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
  /**
   * Цвет значка: итог действия (успех или ошибка) или включённое состояние (акцент — например, открытый
   * замок); по умолчанию — цвет второстепенного текста.
   */
  tone?: 'success' | 'danger' | 'accent'
}

/** Свойства `ActionTextInput`. */
export interface ActionTextInputProps extends TextInputProps {
  /** Кнопки справа внутри поля, слева направо (одна или несколько). */
  action: InputAction | readonly InputAction[]
  /** Поле закрыто для правки (замок): текст приглушён, клавиатура не открывается. */
  locked?: boolean
}

/**
 * Текстовое поле с кнопками-значками справа внутри поля — как глазок у `SecretInput`
 * (тот же вид и отклик на касание: волна на Android, приглушение на iOS).
 */
export function ActionTextInput({ action, locked = false, className = '', ...inputProps }: ActionTextInputProps) {
  const actions = Array.isArray(action) ? action : [action as InputAction]
  return (
    <div className={`input-with-action${actions.length > 1 ? ' has-actions-2' : ''}`}>
      <TextInput {...inputProps} readOnly={locked || inputProps.readOnly} className={`${className}${locked ? ' is-locked' : ''}`.trim()} />
      <div className="input-actions">
        {actions.map(({ icon, label, onClick, busy = false, disabled = false, tone }) => (
          <button
            key={label}
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
        ))}
      </div>
    </div>
  )
}
