import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Сколько строк-заполнителей добавить под силуэтами полей и сколько точек прибавить каждой строке. */
export interface SkeletonFill {
  rows: number
  extra: number
}

/** Без заполнения: только строки полей, своей высоты. */
const NO_FILL: SkeletonFill = { rows: 0, extra: 0 }

/**
 * Заполнение карточки силуэтами до низа, без пустого места (`LabelFieldsSkeleton`, пока фото нет). Строки полей —
 * своей, настоящей высоты (её даёт шрифт устройства, поэтому её меряем, а не задаём числом). Если в карточке под ними
 * есть место — добавляются целые строки-заполнители, сколько помещается, а остаток (меньше строки) поровну делится
 * между строками. Места нет — ничего не добавляется: карточка такая же, как с данными.
 *
 * Мерим без заполнения: сначала строки полей одни, затем — сколько места под ними. Когда карточка меняет размер
 * (поворот экрана, другая шапка), заполнение снимается и считается заново.
 * @param containerRef Блок силуэтов (тянется на свободное место карточки).
 * @param listRef Список строк в нём.
 * @param enabled Заполнять (фото нет); иначе — только строки полей.
 */
export function useSkeletonFill(containerRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLElement | null>, enabled: boolean): SkeletonFill {
  /** `null` — пора мерить (заполнения нет). */
  const [fill, setFill] = useState<SkeletonFill | null>(null)
  /** Высота блока при последнем замере: заполнение её не меняет, поэтому другая высота — повод мерить заново. */
  const measuredHeight = useRef(0)

  useLayoutEffect(() => {
    const container = containerRef.current
    const list = listRef.current
    if (!enabled || fill || !container || !list || list.children.length === 0) return
    const content = list.getBoundingClientRect().height
    const padding = Number.parseFloat(getComputedStyle(container).paddingBottom) || 0
    measuredHeight.current = container.getBoundingClientRect().height
    const free = measuredHeight.current - padding - content
    const rowHeight = content / list.children.length
    const rows = free > 0 ? Math.floor(free / rowHeight) : 0
    const extra = free > 0 ? (free - rows * rowHeight) / (list.children.length + rows) : 0
    setFill({ rows, extra })
  }, [containerRef, listRef, enabled, fill])

  // Блок стал выше или ниже, чем при замере (раскладка карточки устоялась позже, поворот, другая шапка), —
  // посчитать заново. Само заполнение высоту не меняет: строк добавляется не больше, чем помещается.
  useEffect(() => {
    const container = containerRef.current
    if (!enabled || !container) return
    const observer = new ResizeObserver(() => {
      if (Math.abs(container.getBoundingClientRect().height - measuredHeight.current) >= 1) setFill(null)
    })
    observer.observe(container)
    const reset = () => setFill(null)
    window.addEventListener('resize', reset)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', reset)
    }
  }, [containerRef, enabled])

  return enabled && fill ? fill : NO_FILL
}
