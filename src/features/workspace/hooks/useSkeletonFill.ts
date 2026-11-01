import { useLayoutEffect, useState, type RefObject } from 'react'

/** Настоящая высота строк полей, измеренная на устройстве. */
interface NaturalRows {
  /** Высота одной строки. */
  row: number
  /** Высота всех строк полей вместе с нижним отступом блока: ниже блок не становится. */
  fields: number
}

/** Заполнение карточки силуэтами. */
export interface SkeletonFill {
  /** Сколько строк-заполнителей поместится под строками полей. */
  rows: number
  /** Высота строк полей с нижним отступом блока: ниже блок не становится. */
  minHeight: number
}

/**
 * Заполнение карточки силуэтами до низа, без пустого места (`LabelFieldsSkeleton`, пока фото нет). Строки полей —
 * своей, настоящей высоты (её даёт шрифт устройства, поэтому её меряем, а не задаём числом). Если в карточке под ними
 * есть место — добавляются целые строки-заполнители, сколько помещается; строки делят место поровну.
 *
 * Мерим один раз (`null` — ещё не измерено): строки полей стоят в потоке. Дальше строки лежат слоем поверх блока,
 * а блок держится свободного места карточки (но не ниже строк полей), поэтому меняет размер вместе с местом —
 * поворот экрана, появилась или ушла панель листания, — и число заполнителей считается по его высоте.
 * @param containerRef Блок силуэтов (тянется на свободное место карточки).
 * @param listRef Список строк в нём.
 * @param enabled Заполнять (фото нет); иначе — `null`, только строки полей.
 * @param fieldCount Сколько строк полей: другое число — мерим заново.
 */
export function useSkeletonFill(containerRef: RefObject<HTMLElement | null>, listRef: RefObject<HTMLElement | null>, enabled: boolean, fieldCount: number): SkeletonFill | null {
  const [natural, setNatural] = useState<{ count: number; rows: NaturalRows } | null>(null)
  const [rows, setRows] = useState(0)
  const measured = natural && natural.count === fieldCount ? natural.rows : null

  // Замер: строки полей в потоке, своей высоты.
  useLayoutEffect(() => {
    const container = containerRef.current
    const list = listRef.current
    if (!enabled || measured || !container || !list || list.children.length === 0) return
    const content = list.getBoundingClientRect().height
    const padding = Number.parseFloat(getComputedStyle(container).paddingBottom) || 0
    setNatural({ count: fieldCount, rows: { row: content / list.children.length, fields: content + padding } })
  }, [containerRef, listRef, enabled, measured, fieldCount])

  // Сколько заполнителей помещается — по высоте блока, и заново, когда она меняется.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!enabled || !measured || !container) return
    const count = () => setRows(Math.max(0, Math.floor((container.getBoundingClientRect().height - measured.fields) / measured.row)))
    count()
    const observer = new ResizeObserver(count)
    observer.observe(container)
    return () => observer.disconnect()
  }, [containerRef, enabled, measured])

  return enabled && measured ? { rows, minHeight: measured.fields } : null
}
