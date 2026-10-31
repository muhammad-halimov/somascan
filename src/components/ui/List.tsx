import type { AriaRole, ReactNode, Ref } from 'react'
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
  /** Элемент списка (плавная перестановка строк — `useListReorder`). */
  ref?: Ref<HTMLUListElement>
}

/** Плоский список в стиле Material: строки без карточек, разделённые тонкими линиями. */
export function List({ children, role, label, disabled = false, className = '', ref }: ListProps) {
  return (
    <ul
      ref={ref}
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
  /** Своя кнопка справа, вне строки-кнопки (например, замок): её нажатие не нажимает строку. */
  action?: ReactNode
  /** Ключ строки для плавной перестановки (`useListReorder`). */
  reorderKey?: string
}

/**
 * Строка списка. С `onClick` вся строка — кнопка; без него — просто строка
 * (в `trailing` можно положить свою кнопку, например «удалить»).
 */
export function ListItem({ primary, secondary, secondaryTone = 'default', leading, trailing, selected = false, disabled = false, onClick, itemRole, className = '', expanded, controls, action, reorderKey }: ListItemProps) {
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

  const aside = action && <span className="list-item-action">{action}</span>
  if (!onClick) return <li className={classes} data-reorder-key={reorderKey}>{content}{aside}</li>
  return (
    <li role="none" className={action ? 'list-item-row' : undefined} data-reorder-key={reorderKey}>
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
      {aside}
    </li>
  )
}
