import type { ReactNode } from 'react'
import { InfoIcon } from '@/components/icons/Icons'
import './Notice.css'

/** Свойства `Notice`. */
export interface NoticeProps {
  /** Текст пояснения. */
  children: ReactNode
}

/** Плашка-пояснение с иконкой «i»: статус функции, ограничения, подсказки к разделу. */
export function Notice({ children }: NoticeProps) {
  return (
    <p className="notice">
      <InfoIcon />
      <span>{children}</span>
    </p>
  )
}
