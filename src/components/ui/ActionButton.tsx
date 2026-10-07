import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'
import './ActionButton.css'

/**
 * Вид кнопки:
 * - `ghost` — без фона, как в навигационной панели Material: иконка в «пилюле» 56×32,
 *   фон пилюли появляется у активной кнопки (шапка, заголовки панелей);
 * - `tonal` — круг с приглушённым фоном (панель действий, правка);
 * - `accent` — круг акцентного цвета (главное действие);
 * - `overlay` — полупрозрачный круг поверх фото.
 */
export type ActionButtonVariant = 'ghost' | 'tonal' | 'accent' | 'overlay'

/** Свойства `ActionButton`. */
export interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Иконка. */
  icon: ReactNode
  /** Короткая подпись под иконкой. */
  caption: string
  /** Полное доступное имя для экранных дикторов, если подпись слишком краткая. По умолчанию — подпись. */
  label?: string
  /** Вид кнопки. */
  variant?: ActionButtonVariant
  /** Диаметр круга в px (для круглых видов). */
  size?: number
  /** Подсвечивает кнопку (например, пока открыта её панель или включён режим). */
  active?: boolean
  /** Небольшой счётчик в углу иконки (число записей в очереди) или `'alert'` — восклицательный знак. */
  badge?: number | 'alert'
  /** Цвет счётчика: акцентный или цвет ошибки. */
  badgeTone?: 'accent' | 'danger'
  /** Идёт фоновая операция: вместо иконки крутится спиннер (кнопка остаётся нажимаемой). */
  busy?: boolean
}

/**
 * Восклицательный знак для счётчика: рисуется SVG, а не символом «!» — у шрифта символ сидит
 * выше центра строки, и в маленьком круге это заметно.
 */
function BadgeAlertGlyph() {
  return (
    <svg className="action-button-badge-glyph" viewBox="0 0 10 10">
      <path d="M5 1.6v4" />
      <circle cx="5" cy="8.1" r="0.95" />
    </svg>
  )
}

/**
 * Кнопка-иконка с подписью снизу.
 *
 * Ширина кнопки равна ширине круга (или пилюли у `ghost`), а подпись не может быть
 * шире кнопки: длинный текст обрезается многоточием. Поэтому подписи в переводах короткие.
 */
export function ActionButton({ icon, caption, label, variant = 'tonal', size, active = false, badge, badgeTone = 'accent', busy = false, className = '', style, ...rest }: ActionButtonProps) {
  const classes = ['action-button', `is-${variant}`, active && 'is-active', busy && 'is-busy', className].filter(Boolean).join(' ')
  return (
    <button
      type="button"
      className={classes}
      aria-label={label ?? caption}
      aria-busy={busy || undefined}
      style={size ? { ...style, '--action-size': `${size}px` } as CSSProperties : style}
      {...rest}
    >
      <span className="action-button-icon">{busy ? <span className="action-button-spinner" /> : icon}</span>
      {/* Счётчик — вне круга иконки: тот обрезает содержимое (волна нажатия на Android). */}
      {badge !== undefined && badge !== 0 && (
        <span className={`action-button-badge is-${badgeTone}${badge === 'alert' ? ' is-glyph' : ''}`} aria-hidden="true">
          {badge === 'alert' ? <BadgeAlertGlyph /> : badge}
        </span>
      )}
      <span className="action-button-caption" aria-hidden="true">{caption}</span>
    </button>
  )
}
