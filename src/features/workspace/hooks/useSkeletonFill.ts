import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Заполнение карточки силуэтами: строки-заполнители, прибавка к высоте строки и высота строк полей. */
export interface SkeletonFill {
  /** Сколько строк-заполнителей добавить под строками полей. */
  rows: number
  /** Сколько точек прибавить каждой строке: остаток места, меньше строки, поровну. */
  extra: number
  /** Высота строк полей без прибавки (с нижним отступом блока): ниже блок не становится. */
  minHeight: number
}

/**
 * Заполнение карточки силуэтами до низа, без пустого места (`LabelFieldsSkeleton`, пока фото нет). Строки полей —
 * своей, настоящей высоты (её даёт шрифт устройства, поэтому её меряем, а не задаём числом). Если в карточке под ними
 * есть место — добавляются целые строки-заполнители, сколько помещается, а остаток (меньше строки) поровну делится
 * между строками. Места нет — ничего не добавляется: карточка такая же, как с данными.
 *
 * Мерим без заполнения (`null`): строки полей стоят в потоке, и видно, сколько места под ними. После замера строки
 * ложатся слоем поверх блока, а сам блок держится свободного места (но не ниже строк полей): поэтому он меняет
 * размер вместе с местом — поворот экрана, появилась или ушла панель листания, — и заполнение считается заново.
 * @param containerRef Блок силуэтов (тянется на свободное место карточки).
 * @param listRef Список строк в нём.
 * @param enabled Заполнять (фото нет); иначе — `null`, только строки полей.
 */
export function useSkeletonFill(containerRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLElement | null>, enabled: boolean): SkeletonFill | null {
  const [fill, setFill] = useState<SkeletonFill | null>(null)
  /** Высота блока при последнем замере: другая высота — свободного места стало больше или меньше. */
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
    setFill({ rows, extra, minHeight: content + padding })
  }, [containerRef, listRef, enabled, fill])

  useEffect(() => {
    const container = containerRef.current
    if (!enabled || !container) return
    const observer = new ResizeObserver(() => {
      if (Math.abs(container.getBoundingClientRect().height - measuredHeight.current) >= 1) setFill(null)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [containerRef, enabled])

  return enabled ? fill : null
}
