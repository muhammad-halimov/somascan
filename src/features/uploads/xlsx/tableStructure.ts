/**
 * Строение журнала для проверки таблицы в настройках: какие листы — журнал и чем каждый отличается
 * от строгого строения (`strictMismatch`). По нему видно заранее, пойдёт ли запись при «Строгом строении
 * таблицы», — и при смене листа или переключателя без новой проверки.
 */
import type { LayoutMismatch } from './labTableLayout'

/** Строение одного видимого листа. */
export interface SheetStructure {
  /** Имя листа. */
  name: string
  /** На листе есть шапка журнала. */
  journal: boolean
  /** Отличия от строгого строения; `null` — совпадает (или это не журнал). */
  mismatch: LayoutMismatch | null
}

/** Строение книги. */
export interface TableStructure {
  /** Видимые листы по порядку книги. */
  sheets: SheetStructure[]
  /** С какого листа будет скопирована шапка листа нового года (самый новый журнал), или `null`. */
  yearSource: string | null
}

/**
 * Лист, куда пойдёт запись с этими настройками: выбранный, иначе лист года, а если его нет — тот,
 * с которого он будет создан (у нового листа то же строение).
 * @returns `null`, если выбранного листа нет или журнала в книге нет.
 */
export function writeTarget(structure: TableStructure, chosen: string, year: number): SheetStructure | null {
  const byName = (name: string | null) => structure.sheets.find((sheet) => sheet.name === name) ?? null
  if (chosen) return byName(chosen)
  return byName(String(year)) ?? byName(structure.yearSource)
}
