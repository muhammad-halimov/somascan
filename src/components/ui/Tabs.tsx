/**
 * Вкладки: подписи в ряд, у выбранной — акцентный цвет и полоска-индикатор по ширине содержимого.
 * Полоска плавно переезжает к выбранной вкладке. Не помещаются — ряд прокручивается вбок, выбранная видна.
 * Тот же компонент — выбор значения (`radiogroup`: язык, тема, интервал) и разделы окна (`tablist`).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import './Tabs.css'

/** Одна вкладка. */
export interface TabOption<T> {
  value: T
  label: string
  /** Иконка над подписью (например, флаг языка). */
  icon?: ReactNode
}

/** Свойства `Tabs`. */
export interface TabsProps<T> {
  options: readonly TabOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Доступное имя группы. */
  label: string
  role?: 'radiogroup' | 'tablist'
  /** Для `tablist`: префикс id управляемых панелей (`<префикс>-<значение>`). */
  panelIdPrefix?: string
}

/** Вкладки с полоской-индикатором. */
export function Tabs<T extends string | number>({ options, value, onChange, label, role = 'radiogroup', panelIdPrefix }: TabsProps<T>) {
  const isTabList = role === 'tablist'
  const rowRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)
  /** Первое положение — без анимации, чтобы полоска не «прилетала» из угла. */
  const [animated, setAnimated] = useState(false)
  /** Подписи одной строкой: при смене языка индикатор пересчитывается. */
  const labelsKey = options.map((option) => option.label).join('\u0000')

  // положение индикатора: по ширине содержимого активной вкладки; пересчёт при выборе, смене подписей и размеров
  useLayoutEffect(() => {
    const row = rowRef.current
    const content = activeRef.current?.querySelector<HTMLElement>('.tab-content')
    if (!row || !content) return
    const measure = () => {
      const rowBox = row.getBoundingClientRect()
      const box = content.getBoundingClientRect()
      const next = { left: Math.round(box.left - rowBox.left - row.clientLeft + row.scrollLeft), width: Math.round(box.width) }
      setIndicator((cur) => (cur && cur.left === next.left && cur.width === next.width ? cur : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    observer.observe(content)
    return () => observer.disconnect()
  }, [value, labelsKey])

  useEffect(() => {
    if (!indicator || animated) return
    const frame = window.requestAnimationFrame(() => setAnimated(true))
    return () => window.cancelAnimationFrame(frame)
  }, [indicator, animated])

  // выбранная вкладка — в видимой части ряда (прокручивается только ряд, не окно)
  useEffect(() => {
    const row = rowRef.current
    const tab = activeRef.current
    if (!row || !tab) return
    const left = tab.offsetLeft - row.offsetLeft
    if (left < row.scrollLeft) row.scrollLeft = left
    else if (left + tab.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + tab.offsetWidth - row.clientWidth
  }, [value])

  return (
    <div ref={rowRef} className="tabs" role={role} aria-label={label}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={String(option.value)}
            ref={selected ? activeRef : undefined}
            type="button"
            role={isTabList ? 'tab' : 'radio'}
            aria-selected={isTabList ? selected : undefined}
            aria-checked={isTabList ? undefined : selected}
            aria-controls={isTabList && panelIdPrefix ? `${panelIdPrefix}-${String(option.value)}` : undefined}
            className={`tab${selected ? ' is-active' : ''}`}
            onClick={() => onChange(option.value)}
          >
            <span className="tab-content">
              {option.icon && <span className="tab-icon" aria-hidden="true">{option.icon}</span>}
              <span className="tab-label">{option.label}</span>
            </span>
          </button>
        )
      })}
      {indicator && <span className={`tabs-indicator${animated ? ' is-animated' : ''}`} style={{ width: indicator.width, translate: `${indicator.left}px` }} aria-hidden="true" />}
    </div>
  )
}
