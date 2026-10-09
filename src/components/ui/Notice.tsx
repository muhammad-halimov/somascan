import type { ReactNode } from 'react'
import { InfoIcon } from '@/components/icons/Icons'
import './Notice.css'

/** Свойства `Notice`. */
export interface NoticeProps {
  /** Текст пояснения. */
  children: ReactNode
  /** Узкая полоса (одна-две строки): напоминание над блоком, а не пояснение к разделу. */
  compact?: boolean
  /** Дополнительный CSS-класс (размещение). */
  className?: string
}

/** Плашка-пояснение с иконкой «i»: статус функции, ограничения, подсказки к разделу. */
export function Notice({ children, compact = false, className = '' }: NoticeProps) {
  return (
    <p className={['notice', compact && 'is-compact', className].filter(Boolean).join(' ')}>
      <InfoIcon />
      <span>{children}</span>
    </p>
  )
}
