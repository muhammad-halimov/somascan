/**
 * Порядок списков выбора: выбранные пункты — первыми (в своём порядке), остальные — в исходном. Снятый выбор
 * возвращает пункт на его место. Списки, которые раскрываются под полем, берут этот порядок в момент раскрытия:
 * пока список открыт, строки не переставляются под пальцем.
 */
export function selectedFirst<T>(items: readonly T[], isSelected: (item: T) => boolean): T[] {
  return [...items.filter(isSelected), ...items.filter((item) => !isSelected(item))]
}

/**
 * Пункты в порядке, запомненном раньше (`keys`): пропавшие из списка не остаются, новые — в конце, в своём порядке.
 * Так список выбора держит порядок, взятый при раскрытии, пока пункты меняются.
 */
export function inKeyOrder<T>(items: readonly T[], keys: readonly string[], keyOf: (item: T) => string): T[] {
  const rank = new Map(keys.map((key, index) => [key, index]))
  const rankOf = (item: T) => rank.get(keyOf(item)) ?? keys.length
  return [...items].sort((a, b) => rankOf(a) - rankOf(b))
}
