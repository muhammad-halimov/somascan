import { useEffect, useRef } from 'react'
import type { Point } from '../utils/PhotoGeometry'

/** Двойное нажатие: второе нажатие на ту же цель — не позже, чем через столько мс после первого. */
export const DOUBLE_TAP_MS = 300

/** Параметры `useDoubleTap`. */
export interface DoubleTapOptions<K> {
  /** Двойное нажатие. */
  onDouble: (key: K, point: Point) => void
  /**
   * Первое нажатие уже было — им открыли саму цель (нажатие на фото открыло просмотр): второе вовремя —
   * двойное, хотя пришлось уже на просмотр.
   */
  firstTap?: { key: K; at: number }
}

/**
 * Двойное нажатие на одну цель (фото в просмотре). Возвращает обработчик нажатия — ключ цели (второе нажатие
 * на другую цель — снова первое) и точку нажатия на экране.
 */
export function useDoubleTap<K>({ onDouble, firstTap }: DoubleTapOptions<K>) {
  const handler = useRef(onDouble)
  useEffect(() => {
    handler.current = onDouble
  })
  const last = useRef<{ key: K; at: number } | null>(firstTap ?? null)

  return (key: K, point: Point) => {
    const now = performance.now()
    const previous = last.current
    if (previous && Object.is(previous.key, key) && now - previous.at <= DOUBLE_TAP_MS) {
      last.current = null
      handler.current(key, point)
      return
    }
    last.current = { key, at: now }
  }
}
