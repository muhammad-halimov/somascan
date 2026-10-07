import { useId, useRef, type ReactNode } from 'react'
import { ArrowDropDownIcon, ChevronDownIcon } from '@/components/icons/Icons'
import { useHeightTransition } from '@/hooks/useHeightTransition'
import { List, ListItem } from './List'
import './Disclosure.css'

/** Свойства `Disclosure`. */
export interface DisclosureProps {
  /** Раскрыта ли шторка. */
  open: boolean
  /** Нажатие на строку-заголовок: раскрыть или свернуть. */
  onToggle: () => void
  /** Главная строка заголовка: что сейчас выбрано. */
  summary: ReactNode
  /** Вторая строка заголовка (подробности), в одну строку с многоточием. */
  details?: ReactNode
  /** Иконка слева в заголовке. */
  leading?: ReactNode
  /** Содержимое шторки (список выбора). */
  children: ReactNode
  /** Дополнительный CSS-класс. */
  className?: string
  /** Раскрывать нечего: заголовок не нажимается, уголок скрыт. */
  disabled?: boolean
}

/**
 * Шторка: строка-заголовок с текущим выбором и уголком справа; по нажатию ниже плавно
 * раскрывается содержимое (тот же переход высоты, что у «Показать полностью»).
 * На Android и в браузере — выпадающий список Material 3: заголовок как заполненное поле ввода,
 * содержимое на поверхности меню; на iOS — строка сгруппированного списка с уголком.
 * Свёрнутое содержимое недоступно для фокуса и экранных дикторов (`inert`).
 */
export function Disclosure({ open, onToggle, summary, details, leading, children, className = '', disabled = false }: DisclosureProps) {
  const contentId = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  useHeightTransition(contentRef, open)

  return (
    <div className={`disclosure${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}>
      <List className="disclosure-toggle">
        <ListItem
          itemRole="button"
          leading={leading}
          primary={summary}
          secondary={details}
          trailing={(
            // iOS — уголок (chevron), Material — залитый треугольник; нужный показывает CSS по платформе.
            <span className="disclosure-chevron">
              <ChevronDownIcon />
              <ArrowDropDownIcon />
            </span>
          )}
          expanded={open}
          controls={contentId}
          disabled={disabled}
          onClick={onToggle}
        />
      </List>
      <div ref={contentRef} id={contentId} className="disclosure-content" inert={!open}>
        <div className="disclosure-inner">{children}</div>
      </div>
    </div>
  )
}
