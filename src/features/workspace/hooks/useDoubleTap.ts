import { useEffect, useRef } from 'react'
import type { Point } from '../utils/PhotoGeometry'

/**
 * Двойное нажатие: второе нажатие на ту же цель — не позже, чем через столько мс после первого. Столько же ждёт
 * одно нажатие с `deferSingle`: короче — отклик быстрее, но медленное двойное нажатие распадётся на два.
 */
export const DOUBLE_TAP_MS = 220

/** Параметры `useDoubleTap`. */
export interface DoubleTapOptions<K> {
  /** Одно нажатие (необязательно: где одно нажатие ничего не делает, только двойное). */
  onSingle?: (key: K, point: Point) => void
  /** Двойное нажатие. */
  onDouble: (key: K, point: Point) => void
  /**
   * Одно нажатие — только когда второго не было (через `DOUBLE_TAP_MS`): для действий, которые не должны
   * случиться перед двойным (открытие просмотра). Без него — сразу: двойное нажатие продолжает одно (выбор ячейки, затем открытие).
   */
  deferSingle?: boolean
}

/**
 * Одно и двойное нажатие на одну цель (фото в карточке и в просмотре). Возвращает обработчик нажатия — ключ цели
 * (второе нажатие на другую цель — снова одно) и точку нажатия на экране.
 */
export function useDoubleTap<K>({ onSingle, onDouble, deferSingle = false }: DoubleTapOptions<K>) {
  const handlers = useRef({ onSingle, onDouble })
  useEffect(() => {
    handlers.current = { onSingle, onDouble }
  })
  const last = useRef<{ key: K; at: number } | null>(null)
  const pending = useRef(0)
  useEffect(() => () => window.clearTimeout(pending.current), [])

  return (key: K, point: Point) => {
    const now = performance.now()
    const previous = last.current
    window.clearTimeout(pending.current)
    if (previous && Object.is(previous.key, key) && now - previous.at <= DOUBLE_TAP_MS) {
      last.current = null
      handlers.current.onDouble(key, point)
      return
    }
    last.current = { key, at: now }
    if (!deferSingle) {
      handlers.current.onSingle?.(key, point)
      return
    }
    pending.current = window.setTimeout(() => {
      last.current = null
      handlers.current.onSingle?.(key, point)
    }, DOUBLE_TAP_MS)
  }
}
