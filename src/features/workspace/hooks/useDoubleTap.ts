import { useEffect, useRef } from 'react'
import { DOUBLE_TAP_MS, DOUBLE_TAP_SLOP } from '@/lib/interaction/gestures'
import type { Point } from '../utils/PhotoGeometry'

/** Точка нажатия на экране — из события указателя или мыши. */
type ScreenPoint = Pick<MouseEvent, 'clientX' | 'clientY'>

/** Параметры `useDoubleTap`. */
export interface DoubleTapOptions<K> {
  /** Двойное нажатие. */
  onDouble: (key: K, point: Point) => void
  /** Одиночное нажатие: срабатывает, когда время на второе вышло (`DOUBLE_TAP_MS`). Без него одиночное ничего не делает. */
  onSingle?: (key: K, point: Point) => void
}

/** Первое нажатие, ждущее второго; `timer: null` — второе касание уже началось вовремя. */
interface FirstTap<K> {
  key: K
  point: Point
  at: number
  timer: number | null
}

const toPoint = ({ clientX, clientY }: ScreenPoint): Point => ({ x: clientX, y: clientY })

/**
 * Одиночное и двойное нажатие на одну цель (фото в карточке, в просмотре). Ключ — цель: касание другой цели — снова
 * первое нажатие. Обработчики:
 * - `onPress` — касание началось (`pointerdown`): если это второе касание вовремя и рядом с первым, одиночное
 *   нажатие уже не сработает, а отпускание станет двойным;
 * - `onTap` — нажатие (клик, не жест): первое ждёт второго, второе — двойное.
 */
export function useDoubleTap<K>({ onDouble, onSingle }: DoubleTapOptions<K>) {
  const handlers = useRef({ onDouble, onSingle })
  useEffect(() => {
    handlers.current = { onDouble, onSingle }
  })
  const first = useRef<FirstTap<K> | null>(null)
  // Цель ушла с экрана — отложенное одиночное нажатие уже не к месту.
  useEffect(() => () => {
    const timer = first.current?.timer
    if (timer) window.clearTimeout(timer)
  }, [])

  const onPress = (key: K, event: ScreenPoint) => {
    const tap = first.current
    if (!tap) return
    // Второе касание началось, но нажатием не закончилось (стало жестом): начинаем заново.
    if (tap.timer === null) {
      first.current = null
      return
    }
    const point = toPoint(event)
    const inTime = performance.now() - tap.at <= DOUBLE_TAP_MS
    const near = Math.hypot(point.x - tap.point.x, point.y - tap.point.y) <= DOUBLE_TAP_SLOP
    if (inTime && near && Object.is(tap.key, key)) {
      window.clearTimeout(tap.timer)
      tap.timer = null
    }
  }

  const onTap = (key: K, event: ScreenPoint) => {
    const point = toPoint(event)
    const tap = first.current
    first.current = null
    if (tap?.timer === null) {
      handlers.current.onDouble(key, point)
      return
    }
    // Ждавшее первое нажатие было одиночным: это — уже другое.
    if (tap) {
      window.clearTimeout(tap.timer)
      handlers.current.onSingle?.(tap.key, tap.point)
    }
    const timer = window.setTimeout(() => {
      first.current = null
      handlers.current.onSingle?.(key, point)
    }, DOUBLE_TAP_MS)
    first.current = { key, point, at: performance.now(), timer }
  }

  return { onPress, onTap }
}
