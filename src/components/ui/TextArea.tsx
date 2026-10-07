import { useLayoutEffect, useRef, type ComponentProps, type Ref } from 'react'
import './TextInput.css'

/** Свойства `TextArea`. */
export interface TextAreaProps extends Omit<ComponentProps<'textarea'>, 'onChange' | 'value'> {
  /** Текущий текст. */
  value: string
  /** Вызывается с новым текстом при каждом изменении. */
  onChange: (value: string) => void
}

/** Передаёт элемент и во внутренний ref, и во внешний. */
function assignRef<T>(ref: Ref<T> | undefined, value: T) {
  if (typeof ref === 'function') ref(value)
  else if (ref) ref.current = value
}

/**
 * Многострочное текстовое поле в том же стиле, что и `TextInput`; сообщает строки вместо событий.
 * Растёт по содержимому (не меньше `rows` строк) и не прокручивается само: вложенная прокрутка
 * внутри прокручиваемого окна перехватывала бы свайпы.
 * Без автозамены и проверки орфографии: в нём пишут технический текст (например, промпт).
 */
export function TextArea({ value, onChange, className = '', ref, ...rest }: TextAreaProps) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null)

  // Высота по содержимому: сначала сбрасываем, затем ставим высоту всего текста.
  useLayoutEffect(() => {
    const area = innerRef.current
    if (!area) return
    const fit = () => {
      area.style.height = 'auto'
      area.style.height = `${area.scrollHeight}px`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(area.parentElement ?? area)
    return () => observer.disconnect()
  }, [value])

  return (
    <textarea
      ref={(node) => {
        innerRef.current = node
        assignRef(ref, node)
      }}
      className={`text-input is-multiline${className ? ` ${className}` : ''}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      autoComplete="off"
      autoCapitalize="sentences"
      autoCorrect="off"
      spellCheck={false}
      {...rest}
    />
  )
}
