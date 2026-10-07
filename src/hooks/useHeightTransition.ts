import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Раскрытие: длительность растёт с расстоянием (короткое — 320 мс, длинное — до 560 мс),
 * кривая «стандартная» Material 3 — мягкий старт без рывка на первом кадре и плавное торможение.
 */
const MIN_MS = 320
const MAX_MS = 560
const MS_PER_PX = 0.3
const EASING = 'cubic-bezier(.3, 0, 0, 1)'

/** Длительность анимации для изменения высоты на `distance` px. */
const durationFor = (distance: number) => Math.round(Math.min(MAX_MS, Math.max(MIN_MS, 220 + distance * MS_PER_PX)))

/**
 * Плавно раскрывает и сворачивает элемент анимацией высоты (`max-height`).
 *
 * В раскрытом виде ограничение снимается, чтобы содержимое могло расти (правка текста,
 * открывшаяся форма). Первый кадр — без анимации; при `prefers-reduced-motion` — тоже.
 * У элемента должно быть `overflow: hidden`.
 * @param ref Анимируемый элемент.
 * @param isOpen Раскрыт ли он.
 * @param closedHeight Высота в свёрнутом виде по полной высоте содержимого (по умолчанию 0).
 */
export function useHeightTransition(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  closedHeight: (element: HTMLElement, fullHeight: number) => number = () => 0,
) {
  const isFirst = useRef(true)
  // Функция высоты читается из ref, чтобы новая функция при каждом рендере не перезапускала анимацию.
  const closedHeightRef = useRef(closedHeight)
  useLayoutEffect(() => {
    closedHeightRef.current = closedHeight
  })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const full = element.scrollHeight
    const target = isOpen ? full : Math.min(full, closedHeightRef.current(element, full))
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const finish = () => {
      element.style.transition = ''
      element.style.maxHeight = isOpen ? 'none' : `${target}px`
    }
    if (isFirst.current || reduceMotion) {
      isFirst.current = false
      finish()
      return
    }
    const from = element.getBoundingClientRect().height
    if (Math.abs(from - target) < 1) {
      finish()
      return
    }
    // Фиксируем текущую высоту, затем анимируем к целевой.
    element.style.transition = 'none'
    element.style.maxHeight = `${from}px`
    void element.offsetHeight
    const duration = durationFor(Math.abs(target - from))
    element.style.transition = `max-height ${duration}ms ${EASING}`
    element.style.maxHeight = `${target}px`
    const timer = window.setTimeout(finish, duration + 40)
    return () => window.clearTimeout(timer)
  }, [ref, isOpen])
}
