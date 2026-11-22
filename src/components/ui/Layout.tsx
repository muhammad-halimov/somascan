/**
 * Разметка форм: секция с заголовком, поле с подписью, плашка-пояснение, метка статуса.
 */
import type { ReactNode } from 'react'
import { InfoIcon } from '@/components/icons/Icons'
import './Layout.css'

/** Свойства `FormSection`. */
export interface FormSectionProps {
  /** Заголовок (небольшой, акцентного цвета). */
  title: string
  icon?: ReactNode
  /** Элемент управления рядом с заголовком (например, кнопка). */
  action?: ReactNode
  /** Пояснение под содержимым. */
  hint?: ReactNode
  children: ReactNode
}

/** Группа элементов управления с заголовком. */
export function FormSection({ title, icon, action, hint, children }: FormSectionProps) {
  const heading = (
    <h2 className="form-section-title">
      {icon && <span className="form-section-icon" aria-hidden="true">{icon}</span>}
      {title}
    </h2>
  )
  return (
    <section className="form-section">
      {action ? (
        <div className="form-section-header">
          {heading}
          {action}
        </div>
      ) : heading}
      {children}
      {hint && <span className="form-section-hint">{hint}</span>}
    </section>
  )
}

/**
 * Поле формы: подпись сверху, элемент управления снизу (`<label>` связывает их).
 * Обязательное (`required`) — со звёздочкой у подписи; пустое обязательное поле подсвечивает само поле (`is-invalid`).
 */
export function Field({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {required && <span className="field-required" aria-hidden="true"> *</span>}
      </span>
      {children}
    </label>
  )
}

/** Несколько полей рядом, если хватает места. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="field-row">{children}</div>
}

/**
 * Плашка-пояснение с иконкой «i». С `full` — в одну строку: текст со списком переменной длины (имена блоков)
 * обрезается многоточием, целиком — во всплывающей подсказке.
 */
export function Notice({ children, full }: { children: ReactNode; full?: string }) {
  return (
    <p className={`notice${full ? ' is-one-line' : ''}`} title={full}>
      <InfoIcon />
      <span>{children}</span>
    </p>
  )
}

/** Цвет статуса: успех, информация, нейтральный, внимание, ошибка. */
export type StatusTone = 'success' | 'info' | 'neutral' | 'attention' | 'danger'

/**
 * Метка статуса: цветная точка и подпись в одну строку. Не помещается (длинная ошибка системы или сети) —
 * обрезается многоточием, целиком — во всплывающей подсказке.
 */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`status-badge is-${tone}`} title={typeof children === 'string' ? children : undefined}>
      <span className="status-badge-text">{children}</span>
    </span>
  )
}
