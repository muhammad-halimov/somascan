import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './Button.css'

/**
 * Вид кнопки:
 * - `text` — текстовая кнопка без фона, для действий рядом с заголовком («Перечитать»);
 * - `tonal` — «таблетка» с мягкой акцентной заливкой на всю ширину, для действий формы.
 */
export type ButtonVariant = 'text' | 'tonal'

/** Свойства `Button`. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Вид кнопки. */
  variant?: ButtonVariant
  /** Необязательная иконка в начале. */
  icon?: ReactNode
  /** Действие выполняется: кнопка недоступна, иконка вращается. */
  busy?: boolean
}

/** Кнопка с текстом и необязательной иконкой. */
export function Button({ variant = 'text', icon, busy = false, disabled, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`button is-${variant}${className ? ` ${className}` : ''}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {icon && <span className="button-icon-wrap" aria-hidden="true">{icon}</span>}
      <span>{children}</span>
    </button>
  )
}
