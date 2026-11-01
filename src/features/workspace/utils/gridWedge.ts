/**
 * Раскладка сетки бирок «клином»: ячейки стоят вплотную (узкие промежутки и поле), а открытая ячейка раздвигает
 * соседей — промежутки вокруг неё и поле у края карточки рядом с ней шире, сама она чуть крупнее. Обводка и
 * свечение открытой ячейки помещаются в раздвинутые промежутки, не наезжая на соседей и не выходя за карточку.
 *
 * По каждой оси — свои дорожки CSS Grid: поле, ячейка, промежуток, ячейка, …, поле. Ширины — CSS-переменные
 * сетки (`PhotoGrid.css`), так что раскладка задаётся в стилях, а смена открытой ячейки плавно анимируется.
 */

/** Узкий промежуток и поле — далеко от открытой ячейки. */
const GAP = 'var(--photo-grid-gap)'
/** Раздвинутый промежуток (или поле) рядом с открытой ячейкой. */
const WEDGE = 'var(--photo-grid-wedge)'
/** Обычная ячейка и открытая (её доля крупнее). */
const CELL = 'minmax(0, 1fr)'
const ACTIVE_CELL = 'minmax(0, var(--photo-grid-active-fr))'

/**
 * Дорожки одной оси (`grid-template-columns` или `grid-template-rows`) для `count` ячеек, где открыта ячейка
 * `active` (её номер по этой оси) или никакая (`null`).
 */
export function wedgeTracks(count: number, active: number | null): string {
  const tracks: string[] = []
  for (let line = 0; line <= count; line++) {
    // Промежуток перед ячейкой `line` (у последней — поле после неё): у открытой ячейки — раздвинут.
    tracks.push(active !== null && (line === active || line === active + 1) ? WEDGE : GAP)
    if (line < count) tracks.push(line === active ? ACTIVE_CELL : CELL)
  }
  return tracks.join(' ')
}

/** Линия начала ячейки `index` по оси в дорожках `wedgeTracks` (дорожки ячеек — через одну, после поля). */
export const wedgeLine = (index: number) => 2 * index + 2
