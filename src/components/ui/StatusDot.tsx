import './StatusDot.css'

/** Состояние точки: зелёная — готово, красная — нет, жёлтая мигающая — в процессе. */
export type StatusDotTone = 'success' | 'danger' | 'pending'

/** Свойства `StatusDot`. */
export interface StatusDotProps {
  /** Цвет и поведение. */
  tone: StatusDotTone
  /** Доступное имя («Загружена в память» и т. п.). */
  label: string
}

/**
 * Точка состояния 8×8 — та же, что у «Локальное подключение» (`StatusBadge`), без подписи.
 * `pending` мигает; при `prefers-reduced-motion` горит ровно.
 */
export function StatusDot({ tone, label }: StatusDotProps) {
  return <span className={`status-dot is-${tone}`} role="img" aria-label={label} title={label} />
}
