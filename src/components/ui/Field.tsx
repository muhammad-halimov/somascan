import type { ReactNode } from 'react'
import './Field.css'

/** Свойства `Field`. */
export interface FieldProps {
  /** Подпись над элементом управления. */
  label: string
  /** Элемент управления (input, select…); оборачивающий `<label>` связывает подпись с ним. */
  children: ReactNode
}

/** Поле формы с подписью. */
export function Field({ label, children }: FieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}

/** Размещает несколько полей рядом, если хватает места. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="field-row">{children}</div>
}
