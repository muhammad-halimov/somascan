import type { AriaRole, ReactNode } from 'react'
import './List.css'

/** Свойства `List`. */
export interface ListProps {
  /** Пункты списка (`ListItem`). */
  children: ReactNode
  /** Роль контейнера: например, `radiogroup` для выбора одного пункта. */
  role?: AriaRole
  /** Доступное имя списка. */
  label?: string
  /** Делает пункты неактивными (только просмотр). */
  disabled?: boolean
  /** Дополнительный CSS-класс (например, для ограничения высоты). */
  className?: string
}

/** Плоский список в стиле Material: строки без карточек, разделённые тонкими линиями. */
export function List({ children, role, label, disabled = false, className = '' }: ListProps) {
  return (
    <ul
      className={`list${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
      role={role}
      aria-label={label}
      aria-disabled={disabled || undefined}
    >
      {children}
    </ul>
  )
}

/** Свойства `ListItem`. */
export interface ListItemProps {
  /** Основной текст. */
  primary: ReactNode
  /** Второстепенный текст под основным. */
  secondary?: ReactNode
  /** Цвет второстепенного текста: обычный или как у ошибки. */
  secondaryTone?: 'default' | 'error'
  /** Элемент слева (иконка статуса). */
  leading?: ReactNode
  /** Элемент справа (галочка, кнопка). */
  trailing?: ReactNode
  /** Выбранный пункт: акцентный цвет. */
  selected?: boolean
  /** Пункт нельзя нажать. */
  disabled?: boolean
  /** Если задан, строка — кнопка. */
  onClick?: () => void
  /** Роль строки-кнопки (`radio` — выбор одного, `checkbox` — выбор нескольких); тогда `selected` отражается в `aria-checked`. */
  itemRole?: 'radio' | 'checkbox' | 'button'
  /** Дополнительный CSS-класс строки (анимации появления и удаления). */
  className?: string
  /** Строка раскрывает шторку: состояние для `aria-expanded`. */
  expanded?: boolean
  /** Id элемента, который строка раскрывает (`aria-controls`). */
  controls?: string
}

/**
 * Строка списка. С `onClick` вся строка — кнопка; без него — просто строка
 * (в `trailing` можно положить свою кнопку, например «удалить»).
 */
export function ListItem({ primary, secondary, secondaryTone = 'default', leading, trailing, selected = false, disabled = false, onClick, itemRole, className = '', expanded, controls }: ListItemProps) {
  const classes = `list-item${selected ? ' is-selected' : ''}${className ? ` ${className}` : ''}`
  const content = (
    <>
      {leading && <span className="list-item-leading">{leading}</span>}
      <span className="list-item-text">
        <span className="list-item-primary">{primary}</span>
        {secondary && <span className={`list-item-secondary${secondaryTone === 'error' ? ' is-error' : ''}`}>{secondary}</span>}
      </span>
      {trailing && <span className="list-item-trailing">{trailing}</span>}
    </>
  )

  if (!onClick) return <li className={classes}>{content}</li>
  return (
    <li role="none">
      <button
        type="button"
        role={itemRole}
        aria-checked={itemRole === 'radio' || itemRole === 'checkbox' ? selected : undefined}
        aria-expanded={expanded}
        aria-controls={controls}
        className={`${classes} is-interactive`}
        disabled={disabled}
        onClick={onClick}
      >
        {content}
      </button>
    </li>
  )
}
