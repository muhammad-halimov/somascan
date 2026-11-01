import { useEffect, useRef } from 'react'
import type { Point } from '../utils/PhotoGeometry'

/**
 * Двойное нажатие: второе нажатие на ту же цель — не позже, чем через столько мс после первого. Столько же ждёт
 * одиночное нажатие (`onSingle`), прежде чем сработать: короче — двойное не успеть, длиннее — нажатие кажется
 * неотзывчивым.
 */
export const DOUBLE_TAP_MS = 250

/** Параметры `useDoubleTap`. */
export interface DoubleTapOptions<K> {
  /** Двойное нажатие. */
  onDouble: (key: K, point: Point) => void
  /** Одиночное нажатие: срабатывает, когда время на второе вышло. Без него одиночное нажатие ничего не делает. */
  onSingle?: (key: K, point: Point) => void
}

/** Первое нажатие, ждущее второго. */
interface PendingTap<K> {
  key: K
  point: Point
  at: number
  timer: number
}

/**
 * Одиночное и двойное нажатие на одну цель (фото в карточке, в просмотре). Возвращает обработчик нажатия — ключ цели
 * (второе нажатие на другую цель — снова первое) и точку нажатия на экране.
 */
export function useDoubleTap<K>({ onDouble, onSingle }: DoubleTapOptions<K>) {
  const handlers = useRef({ onDouble, onSingle })
  useEffect(() => {
    handlers.current = { onDouble, onSingle }
  })
  const pending = useRef<PendingTap<K> | null>(null)
  // Цель ушла с экрана — отложенное одиночное нажатие уже не к месту.
  useEffect(() => () => {
    if (pending.current) window.clearTimeout(pending.current.timer)
  }, [])

  return (key: K, point: Point) => {
    const now = performance.now()
    const previous = pending.current
    pending.current = null
    if (previous) {
      window.clearTimeout(previous.timer)
      if (Object.is(previous.key, key) && now - previous.at <= DOUBLE_TAP_MS) {
        handlers.current.onDouble(key, point)
        return
      }
      // Второе нажатие — на другую цель: первое было одиночным.
      handlers.current.onSingle?.(previous.key, previous.point)
    }
    const timer = window.setTimeout(() => {
      pending.current = null
      handlers.current.onSingle?.(key, point)
    }, DOUBLE_TAP_MS)
    pending.current = { key, point, at: now, timer }
  }
}
