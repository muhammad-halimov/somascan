import type { ReactNode } from 'react'
import './FormSection.css'

/** Свойства `FormSection`. */
export interface FormSectionProps {
  /** Заголовок секции (небольшой, акцентного цвета). */
  title: string
  /** Иконка слева от заголовка. */
  icon?: ReactNode
  /** Необязательный элемент управления рядом с заголовком (например, кнопка «Обновить»). */
  action?: ReactNode
  /** Необязательное пояснение под содержимым. */
  hint?: ReactNode
  /** Содержимое секции. */
  children: ReactNode
}

/** Группа элементов управления с заголовком в форме настроек. */
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
