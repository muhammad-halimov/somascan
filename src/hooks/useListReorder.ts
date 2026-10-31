import { useLayoutEffect, useRef, type RefObject } from 'react'
import { HEIGHT_EASING, heightDurationFor } from './useHeightTransition'

/** Класс строки, которая переезжает дальше всех (выбранная или снятая): поверх соседей, с фоном списка. */
const MOVING_CLASS = 'is-reordering'

/**
 * Плавная перестановка строк списка (FLIP): порядок пунктов сменился — выбранное поднялось наверх, снятое вернулось
 * на место, — и строки переезжают на новые места, а не прыгают. Строки — элементы с `data-reorder-key` внутри
 * `ref`; положения считаются от верха `ref`, поэтому прокрутка и раскрытие шторки их не сбивают. Анимация — только
 * при смене `order` (поиск строки не двигает); при «уменьшить движение» — без неё.
 * @param order Порядок пунктов (например, ключи через «|»).
 */
export function useListReorder(ref: RefObject<HTMLElement | null>, order: string): void {
  const positions = useRef(new Map<string, number>())
  const previousOrder = useRef(order)
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const top = root.getBoundingClientRect().top
    const items = [...root.querySelectorAll<HTMLElement>('[data-reorder-key]')]
    const next = new Map(items.map((item) => [item.dataset.reorderKey!, item.getBoundingClientRect().top - top]))
    const changed = order !== previousOrder.current
    const before = positions.current
    previousOrder.current = order
    positions.current = next
    if (!changed || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const shifts = items.flatMap((item) => {
      const from = before.get(item.dataset.reorderKey!)
      const to = next.get(item.dataset.reorderKey!)!
      return from === undefined || Math.abs(from - to) < 1 ? [] : [{ item, shift: from - to }]
    })
    const farthest = Math.max(0, ...shifts.map(({ shift }) => Math.abs(shift)))
    for (const { item, shift } of shifts) {
      const moving = Math.abs(shift) === farthest
      if (moving) item.classList.add(MOVING_CLASS)
      const animation = item.animate(
        [{ transform: `translateY(${shift}px)` }, { transform: 'translateY(0)' }],
        { duration: heightDurationFor(Math.abs(shift)), easing: HEIGHT_EASING },
      )
      if (moving) animation.addEventListener('finish', () => item.classList.remove(MOVING_CLASS), { once: true })
    }
  })
}
