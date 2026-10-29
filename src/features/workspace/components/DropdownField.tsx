import { useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react'
import { ArrowDropDownIcon, CheckIcon, ChevronDownIcon, PencilIcon } from '@/components/icons/Icons'
import { List, ListItem } from '@/components/ui/List'
import { useHeightTransition } from '@/hooks/useHeightTransition'
// Меню и уголок — те же, что у шторок настроек (`Disclosure`): поверхность меню Material, список iOS.
import '@/components/ui/Disclosure.css'
import './DropdownField.css'

/** Вариант выбора. */
export interface DropdownOption {
  /** Значение, которое уходит в `onChange`. */
  value: string
  /** Подпись на языке интерфейса. */
  label: string
}

/** Своё значение: карандаш превращает текст поля в поле ввода на том же месте. */
export interface DropdownOwnValue {
  /** Доступное имя карандаша. */
  label: string
  /** Подсказка в пустом поле ввода. */
  placeholder: string
  /** Клавиатура поля ввода. */
  keyboard: Pick<InputHTMLAttributes<HTMLInputElement>, 'inputMode' | 'autoCapitalize'>
  /** Enter в поле ввода (переход к следующему полю). */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
}

/** Свойства `DropdownField`. */
export interface DropdownFieldProps {
  /** Название строки (и доступное имя выбора). */
  name: string
  /** Текущее значение: один из вариантов или своё (тогда показывается как есть); пустое без варианта — не выбрано. */
  value: string
  /**
   * Какой вариант отмечен, если он не равен `value` дословно (производитель «SOVEL» — это «Sovel» из списка).
   * В поле ввода своего значения при этом остаётся `value` как есть, с пробелами по ходу ввода.
   */
  selected?: string | null
  /** Варианты в порядке показа. */
  options: readonly DropdownOption[]
  /** Что показать, пока ничего не выбрано. */
  placeholder: string
  /** Режим правки: поле во всю ширину под названием; в просмотре — значение строки со значком списка. */
  isEditing: boolean
  /** Пустое значение — ошибка (без него бирку не отправить): подпись и линия цветом ошибки. */
  required?: boolean
  /** Дополнительный класс строки. */
  className?: string
  /** Выбрано новое значение (или введено своё). */
  onChange: (value: string) => void
  /** Можно вписать своё значение (карандаш слева от уголка); без него — только выбор из списка. */
  own?: DropdownOwnValue
}

/**
 * Строка карточки бирки с выпадающим списком, как шторки настроек: касание значения раскрывает под строкой
 * список вариантов (галочка у выбранного), выбор сворачивает его. В просмотре — значение строки с уголком
 * справа, в правке — поле во всю ширину. С `own` в поле есть карандаш: текст становится полем ввода
 * прямо на месте (никуда не сдвигается), уход с поля или повторное нажатие карандаша возвращает выбор.
 */
export function DropdownField({ name, value, selected, options, placeholder, isEditing, required = false, className = '', onChange, own }: DropdownFieldProps) {
  const menuId = useId()
  const nameId = useId()
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isTyping, setIsTyping] = useState(false)
  useHeightTransition(menuRef, isOpen)

  const option = options.find((candidate) => candidate.value === (selected ?? value))
  const missing = !option && value.trim() === ''
  const text = option ? option.label : missing ? placeholder : value

  const toggle = () => setIsOpen((open) => !open)
  const select = (next: string) => {
    onChange(next)
    setIsOpen(false)
  }
  /** Карандаш: начать или закончить ввод своего значения. */
  const toggleTyping = () => {
    if (isTyping) {
      inputRef.current?.blur()
      return
    }
    setIsOpen(false)
    setIsTyping(true)
  }

  const classes = [
    'label-field',
    'is-dropdown',
    isOpen && 'is-open',
    isTyping && 'is-typing',
    required && missing && 'is-required',
    className,
  ].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <span className="label-field-name" id={nameId}>{name}</span>
      <div className={`label-field-dropdown${isEditing ? ' label-field-input' : ''}`}>
        {isTyping && own ? (
          <input
            ref={inputRef}
            className="label-field-dropdown-text"
            aria-labelledby={nameId}
            value={value}
            placeholder={own.placeholder}
            aria-required={required || undefined}
            // Поле появляется по карандашу — сразу вводим, каретка в конце текста.
            autoFocus
            onFocus={(event) => event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
            onChange={(event) => onChange(event.target.value)}
            onBlur={() => setIsTyping(false)}
            onKeyDown={own.onKeyDown}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            {...own.keyboard}
          />
        ) : (
          <button
            type="button"
            className={`label-field-dropdown-text label-field-dropdown-toggle${missing ? ' is-missing' : ''}`}
            aria-labelledby={nameId}
            aria-expanded={isOpen}
            aria-controls={menuId}
            onClick={toggle}
          >
            {text}
          </button>
        )}
        {own && (
          <button
            type="button"
            className={`input-action label-field-dropdown-own${isTyping ? ' is-active' : ''}`}
            aria-label={own.label}
            aria-pressed={isTyping}
            // Нажатие карандаша не уводит фокус из поля ввода: иначе оно закрылось бы раньше, чем сработает нажатие.
            onPointerDown={(event) => event.preventDefault()}
            onClick={toggleTyping}
          >
            <PencilIcon />
          </button>
        )}
        {/* Уголок дублирует нажатие на значение (для диктора — одна кнопка, значение). */}
        <button type="button" className="label-field-dropdown-chevron" tabIndex={-1} aria-hidden="true" onClick={toggle}>
          <span className="disclosure-chevron">
            <ChevronDownIcon />
            <ArrowDropDownIcon />
          </span>
        </button>
      </div>
      <div ref={menuRef} id={menuId} className="disclosure-content label-field-dropdown-menu" inert={!isOpen}>
        <div className="disclosure-inner">
          <List role="radiogroup" label={name}>
            {options.map((candidate) => {
              const checked = candidate.value === option?.value
              return (
                <ListItem
                  key={candidate.value}
                  itemRole="radio"
                  primary={candidate.label}
                  selected={checked}
                  trailing={checked ? <CheckIcon /> : undefined}
                  onClick={() => select(candidate.value)}
                />
              )
            })}
          </List>
        </div>
      </div>
    </div>
  )
}
