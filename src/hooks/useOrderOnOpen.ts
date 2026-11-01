import { useState } from 'react'
import { inKeyOrder, selectedFirst } from '@/lib/list/selectedFirst'

/**
 * Порядок списка выбора, взятый в момент раскрытия: выбранные — первыми (`selectedFirst`). Пока список открыт и пока
 * сворачивается, строки не переставляются: выбор пункта не двигает список, ничего не переезжает под пальцем.
 * Новый порядок — при следующем раскрытии (`freeze`). До первого раскрытия — текущий порядок.
 * @returns Пункты в этом порядке и `freeze` — запомнить порядок сейчас (вызывать, раскрывая список).
 */
export function useOrderOnOpen<T>(items: readonly T[], isSelected: (item: T) => boolean, keyOf: (item: T) => string) {
  const [keys, setKeys] = useState<readonly string[] | null>(null)
  const current = selectedFirst(items, isSelected)
  return {
    ordered: keys ? inKeyOrder(items, keys, keyOf) : current,
    freeze: () => setKeys(current.map(keyOf)),
  }
}
