import type { ReactNode } from 'react'
import './PanelHeader.css'

/** Свойства `PanelHeader`. */
export interface PanelHeaderProps {
  /** Id элемента заголовка, на который ссылается `aria-labelledby` панели. */
  titleId: string
  /** Текст заголовка. */
  title: string
  /** Уровень заголовка: `h1` для модальных окон, `h2` для поповеров. */
  level?: 1 | 2
  /** Кнопки-иконки справа (сброс, закрытие…). */
  actions: ReactNode
}

/** Шапка модального окна или поповера: заголовок и действия-иконки. */
export function PanelHeader({ titleId, title, level = 2, actions }: PanelHeaderProps) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <header className="panel-header">
      <Heading id={titleId}>{title}</Heading>
      <div className="panel-header-actions">{actions}</div>
    </header>
  )
}
