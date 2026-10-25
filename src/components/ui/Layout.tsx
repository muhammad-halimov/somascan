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

/** Поле формы: подпись сверху, элемент управления снизу (`<label>` связывает их). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}

/** Несколько полей рядом, если хватает места. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="field-row">{children}</div>
}

/** Плашка-пояснение с иконкой «i». */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="notice">
      <InfoIcon />
      <span>{children}</span>
    </p>
  )
}

/** Цвет статуса: успех, информация, нейтральный, внимание, ошибка. */
export type StatusTone = 'success' | 'info' | 'neutral' | 'attention' | 'danger'

/** Метка статуса: цветная точка и подпись. */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`status-badge is-${tone}`}>{children}</span>
}
