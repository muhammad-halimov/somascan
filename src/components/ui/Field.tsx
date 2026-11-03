import { useId, type ReactNode } from 'react'
import './Field.css'

/** Свойства `Field`. */
export interface FieldProps {
  /** Подпись над элементом управления (текст, может быть с иконкой — например, флагом языка). */
  label: ReactNode
  /** Элемент управления (поле ввода); оборачивающий `<label>` связывает подпись с ним. */
  children: ReactNode
  /**
   * Элемент управления — не поле ввода, а шторка выбора (`Disclosure`) с кнопками: подпись называет группу,
   * а не оборачивающий `<label>` — тот отдал бы её первой кнопке внутри.
   */
  group?: boolean
}

/** Поле формы с подписью. */
export function Field({ label, children, group = false }: FieldProps) {
  const labelId = useId()
  if (group) {
    return (
      <div className="field" role="group" aria-labelledby={labelId}>
        <span className="field-label" id={labelId}>{label}</span>
        {children}
      </div>
    )
  }
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
