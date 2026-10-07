import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import './Tabs.css'

/** Одна вкладка. */
export interface TabOption<T> {
  /** Значение, которое уходит в `onChange`. */
  value: T
  /** Подпись вкладки. */
  label: string
  /** Необязательная иконка над подписью (например, флаг языка). */
  icon?: ReactNode
}

/** Свойства `Tabs`. */
export interface TabsProps<T> {
  /** Вкладки в порядке показа. */
  options: readonly TabOption<T>[]
  /** Выбранное значение. */
  value: T
  /** Вызывается с выбранным значением. */
  onChange: (value: T) => void
  /** Доступное имя группы для экранных дикторов. */
  label: string
  /**
   * `radiogroup` (по умолчанию) — выбор значения (язык, провайдер, размер);
   * `tablist` — переключение разделов (вкладки настроек).
   */
  role?: 'radiogroup' | 'tablist'
  /** Для `tablist`: префикс id управляемых панелей (`<префикс>-<значение>`). */
  panelIdPrefix?: string
}

/** Положение полоски-индикатора относительно ряда вкладок. */
interface IndicatorBox {
  left: number
  width: number
}

/**
 * На iOS вкладки выглядят как сегментированный переключатель (UISegmentedControl):
 * индикатор — «плашка» под всей выбранной вкладкой, а не полоска под подписью.
 */
const isSegmentedStyle = () => document.documentElement.dataset.platform === 'ios'

/** Естественные ширины сегментов — без сжатия и многоточия (режим замера, см. platform-ios.css). */
function naturalSegmentWidths(row: HTMLElement): number[] {
  row.setAttribute('data-measuring', '')
  const widths = [...row.querySelectorAll<HTMLElement>(':scope > .tab')].map((tab) => tab.getBoundingClientRect().width)
  row.removeAttribute('data-measuring')
  return widths
}

/** Ширина, доступная сегментам внутри дорожки. */
function availableSegmentWidth(row: HTMLElement): number {
  const style = getComputedStyle(row)
  return row.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
}

/** Ступени плотности сегментов: обычный вид, плотнее (`compact`), плотнее и мельче шрифт (`tight`). */
const DENSITIES = ['compact', 'tight'] as const

/** Помещаются ли подписи: самый широкий сегмент (замер — жирным, как у выбранного), умноженный на их число. */
function segmentsFit(row: HTMLElement) {
  const widths = naturalSegmentWidths(row)
  return Math.max(...widths) * widths.length <= availableSegmentWidth(row) - 1
}

/**
 * Подбирает вид сегментов, как UISegmentedControl: сегменты всегда равной ширины.
 * Если самая длинная подпись (жирным, как у выбранного сегмента) не помещается, ряд становится плотнее
 * (`data-density="compact"`: меньше отступы и иконки), затем ещё и шрифт мельче (`tight`) — как
 * adjustsFontSizeToFitWidth у UIKit; многоточие — только если не помогло и это.
 * Каждый раз начинаем с обычного вида, чтобы при расширении экрана он вернулся.
 */
function fitSegments(row: HTMLElement) {
  row.removeAttribute('data-density')
  if (segmentsFit(row)) return
  for (const density of DENSITIES) {
    row.setAttribute('data-density', density)
    if (segmentsFit(row)) return
  }
}

/**
 * Вкладки в стиле Material 3: подпись и полоска-индикатор под активной вкладкой.
 * Индикатор плавно переезжает к выбранной вкладке и подстраивается под её ширину.
 * Вкладки делят ширину поровну; если не помещаются — ряд прокручивается вбок,
 * и выбранная вкладка автоматически попадает в видимую область.
 * На iOS тот же компонент оформлен как сегментированный переключатель (см. platform-ios.css).
 */
export function Tabs<T extends string | number | null>({ options, value, onChange, label, role = 'radiogroup', panelIdPrefix }: TabsProps<T>) {
  const isTabList = role === 'tablist'
  const rowRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)
  const [indicator, setIndicator] = useState<IndicatorBox | null>(null)
  /** Первое положение ставим без анимации, чтобы полоска не «прилетала» из угла. */
  const [animated, setAnimated] = useState(false)
  /**
   * Палец лежит на уже выбранном сегменте (нажат, когда тот был выбран): плашка на iOS чуть сжимается,
   * как у UISegmentedControl. Только так: подсветка нажатия держится ещё ~70 мс после касания, и если
   * сжимать по ней, плашка только что выбранного сегмента дёргалась бы на ходу (сжатие и возврат).
   */
  const [isHoldingActive, setIsHoldingActive] = useState(false)
  /** Подписи одной строкой: при смене языка индикатор и сегменты пересчитываются. */
  const labelsKey = options.map((option) => option.label).join('\u0000')

  // Плотность сегментов (iOS) зависит только от подписей и ширины ряда, а не от выбора:
  // подбираем её при смене подписей и изменении размеров, а не при каждом нажатии.
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row || !isSegmentedStyle()) return
    fitSegments(row)
    let width = row.clientWidth
    const observer = new ResizeObserver(() => {
      if (row.clientWidth === width) return
      width = row.clientWidth
      fitSegments(row)
    })
    observer.observe(row)
    return () => observer.disconnect()
  }, [labelsKey])

  // Положение индикатора: по ширине содержимого активной вкладки (на iOS — по всей вкладке).
  // Пересчитываем при выборе, смене подписей и изменении размеров (поворот экрана, смена плотности).
  useLayoutEffect(() => {
    const row = rowRef.current
    const tab = activeRef.current
    const segmented = isSegmentedStyle()
    const content = segmented ? tab : tab?.querySelector<HTMLElement>('.tab-content')
    if (!row || !content) return
    const measure = () => {
      // Окно с вкладками появляется с анимацией масштаба: getBoundingClientRect учитывает transform,
      // поэтому делим на текущий масштаб ряда — иначе плашка выходит меньше сегмента и сдвинута.
      const rowBox = row.getBoundingClientRect()
      const box = content.getBoundingClientRect()
      const scale = row.offsetWidth > 0 ? rowBox.width / row.offsetWidth : 1
      // Округляем до физических пикселей экрана: дробная позиция по-разному округляется во время
      // анимации и после неё, и плашка в конце переезда «вздрагивала».
      const pixel = window.devicePixelRatio || 1
      const snap = (value: number) => Math.round(value * pixel) / pixel
      const next = { left: snap((box.left - rowBox.left) / scale - row.clientLeft + row.scrollLeft), width: snap(box.width / scale) }
      // Без изменений не обновляем состояние, чтобы не вызывать лишний рендер.
      setIndicator((current) => (current && current.left === next.left && current.width === next.width ? current : next))
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

  // Сжатие плашки снимается, как только палец отпущен (где угодно) или касание отменено.
  useEffect(() => {
    if (!isHoldingActive) return
    const release = () => setIsHoldingActive(false)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [isHoldingActive])

  // Докручиваем ряд так, чтобы выбранная вкладка была видна целиком.
  // Прокручиваем только сам ряд (а не страницу), поэтому без scrollIntoView.
  useEffect(() => {
    const row = rowRef.current
    const tab = activeRef.current
    if (!row || !tab) return
    const left = tab.offsetLeft - row.offsetLeft
    if (left < row.scrollLeft) row.scrollLeft = left
    else if (left + tab.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left + tab.offsetWidth - row.clientWidth
  }, [value])

  return (
    <div ref={rowRef} className={`tabs${isHoldingActive ? ' is-holding' : ''}`} role={role} aria-label={label}>
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
            onPointerDown={() => setIsHoldingActive(selected)}
            onClick={() => onChange(option.value)}
          >
            <span className="tab-content">
              {option.icon && <span className="tab-icon" aria-hidden="true">{option.icon}</span>}
              {/*
                Подпись дважды — обычным и жирным начертанием в одной ячейке: на iOS выбранная подпись
                жирная, и при переключении начертания плавно сменяются (как у UISegmentedControl),
                а ширина подписи не меняется — текст не вздрагивает. На Android жирная копия скрыта.
              */}
              <span className="tab-label">
                <span className="tab-label-regular">{option.label}</span>
                <span className="tab-label-bold" aria-hidden="true">{option.label}</span>
              </span>
            </span>
          </button>
        )
      })}
      {indicator && (
        <span
          className={`tabs-indicator${animated ? ' is-animated' : ''}`}
          // Позиция — свойством translate: анимацию ведёт композитор (Core Animation на iOS), поэтому плашка
          // едет ровно, даже пока основной поток монтирует новую вкладку; scale при нажатии сжимает её на месте.
          // Подписи на iOS — в собственных слоях (platform-ios.css), иначе WebKit рисовал плашку поверх них.
          style={{ width: indicator.width, translate: `${indicator.left}px` }}
          aria-hidden="true"
        />
      )}
    </div>
  )
}
