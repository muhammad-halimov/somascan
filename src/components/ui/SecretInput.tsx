import { useLayoutEffect, useRef, useState } from 'react'
import { EyeIcon, EyeOffIcon } from '@/components/icons/Icons'
import { TextInput, type TextInputProps } from './TextInput'
import './TextInput.css'

/** Свойства `SecretInput`. */
export interface SecretInputProps extends Omit<TextInputProps, 'type'> {
  /** Доступная подпись переключателя, пока значение скрыто. */
  showLabel: string
  /** Доступная подпись переключателя, пока значение видно. */
  hideLabel: string
  /**
   * `token` (по умолчанию) — API-ключ и прочие секреты не для менеджеров паролей: обычное
   * текстовое поле, скрытое стилем (`-webkit-text-security`), без клавиши «Пароли» на iOS
   * и автозаполнения Android; `password` — настоящий пароль (`type="password"`),
   * который менеджеры паролей могут подставлять и сохранять.
   */
  kind?: 'token' | 'password'
}

/**
 * Поле для секретов (API-ключи, пароли): по умолчанию значение скрыто,
 * кнопка с глазом позволяет показать его для проверки.
 */
export function SecretInput({ showLabel, hideLabel, kind = 'token', className = '', ...inputProps }: SecretInputProps) {
  const [visible, setVisible] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Положение каретки на момент переключения «глазка»: смена type сбрасывает его в WebKit. */
  const selection = useRef<[number | null, number | null] | null>(null)
  const masked = !visible && kind === 'token'

  const toggle = () => {
    const input = inputRef.current
    selection.current = input && document.activeElement === input ? [input.selectionStart, input.selectionEnd] : null
    setVisible((current) => !current)
  }

  // После смены type возвращаем каретку туда, где она была: поле остаётся в фокусе, набор продолжается с того же места.
  useLayoutEffect(() => {
    const input = inputRef.current
    const saved = selection.current
    selection.current = null
    if (!input || !saved || document.activeElement !== input) return
    try {
      input.setSelectionRange(saved[0], saved[1])
    } catch {
      // Для некоторых типов полей выделение недоступно — тогда просто оставляем как есть.
    }
  }, [visible])

  return (
    <div className="input-with-action secret-input">
      <TextInput
        {...inputProps}
        ref={inputRef}
        className={`${className}${masked ? ' is-masked' : ''}`.trim()}
        type={!visible && kind === 'password' ? 'password' : 'text'}
      />
      <button
        type="button"
        className="input-action"
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        onClick={toggle}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  )
}
