import type { ReactNode } from 'react'
import './StatusBadge.css'

/** Свойства `StatusBadge`. */
export interface StatusBadgeProps {
  /** Цвет: зелёный для OK, акцентный для информации, серый для нейтрального, красный для ошибки. */
  tone: 'success' | 'info' | 'neutral' | 'danger'
  /** Текст бейджа. */
  children: ReactNode
}

/** Небольшая цветная метка статуса. */
export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return <span className={`status-badge is-${tone}`}>{children}</span>
}
