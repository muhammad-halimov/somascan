/**
 * Шапка таблицы лаборатории по тексту первых строк листов — без ExcelJS. Так её находят и движок
 * (`LaboratorBook.layout`), и проверка таблицы на вкладке «Хранилище» (главный процесс читает только первые
 * строки книги, `host/workbookHead`): обе сверяют таблицу одинаково.
 *
 * Лист — тот, где в первых `HEADER_ROWS` строках есть шапка с «Rc decofr.»; через несколько колонок — «Rc 28 zile»
 * и справа от неё колонка бюллетеня. Прежний вид (бюллетень и дата в одной ячейке с прочностью) — колонки,
 * которые делит миграция (`splits`); разделённый — справа от «Rc decofr.» стоят «Nr.bul.» и «Data».
 *
 * РИСК: колонки находятся по словам шапки («decofr», «28 zile», «Nr.bul», «Data»): переименованная шапка —
 * таблица не узнаётся (ошибка с причиной).
 */
import { message, MessageError } from '@/shared/messages'
import { cleanText } from '@/shared/names'

/** Сколько первых строк листа просматривается в поисках шапки. */
export const HEADER_ROWS = 20

/** Первые строки листа: номер строки → номер колонки → текст ячейки как есть (с переносами строк). */
export interface SheetHead {
  name: string
  rows: ReadonlyMap<number, ReadonlyMap<number, string>>
}

/** Колонка, которая делится. */
export interface SplitColumn {
  /** Номер колонки в прежнем виде. */
  column: number
  /** Название для журнала: «Rc decofr.», «Rc 28 zile». */
  title: string
  /**
   * Прочность в той же ячейке («Rc decofr.»): колонка остаётся прочностью, справа появляются «Nr.bul.» и «Data».
   * Иначе это колонка бюллетеня справа от «Rc 28 zile»: она становится «Nr.bul.», справа появляется «Data».
   */
  withValue: boolean
}

/** Где шапка и колонки таблицы. */
export interface LabHeader {
  /** Номер листа в списке. */
  sheet: number
  /** Строка шапки. */
  header: number
  /** Колонка «Rc decofr.» в таблице как она есть: в разделённой справа от неё — «Nr.bul.» и «Data». */
  decofr: number
  /** Колонка «Rc 28 zile». */
  day28: number
  /** Колонки, которые ещё не разделены, по возрастанию; пусто — таблица уже разделена. */
  splits: SplitColumn[]
}

/** Текст шапки для сравнения: без регистра и лишних пробелов. */
const norm = (value: unknown) => cleanText(value).toLowerCase()

/** Первая строка заголовка: «Rc decofr.↵Nr.bul./↵Data» → «Rc decofr.». */
const firstLine = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''

/**
 * Находит шапку и колонки.
 * @throws {MessageError} Шапки нет или она не похожа ни на прежний, ни на разделённый вид.
 */
export function findHeader(sheets: readonly SheetHead[]): LabHeader {
  for (const [index, sheet] of sheets.entries()) {
    for (let r = 1; r <= HEADER_ROWS; r++) {
      const row = sheet.rows.get(r)
      if (!row) continue
      const raw = (c: number) => row.get(c) ?? ''
      const head = (c: number) => norm(raw(c))
      const columns = [...row.keys()].sort((a, b) => a - b)
      const decofr = columns.find((c) => head(c).includes('decofr')) ?? 0
      if (!decofr) continue
      const day28 = columns.find((c) => head(c).includes('28 zile')) ?? 0
      if (!day28 || !head(day28 + 1).includes('nr.bul')) throw new MessageError(message('laborator.no28', { row: r }))
      const splits: SplitColumn[] = []
      // прежний вид: «Rc decofr. Nr.bul./ Data» в одной шапке; разделённый — «Rc decofr.», справа «Nr.bul.»
      if (head(decofr).includes('nr.bul')) splits.push({ column: decofr, title: firstLine(raw(decofr)), withValue: true })
      else if (!head(decofr + 1).startsWith('nr.bul')) throw new MessageError(message('laborator.layout', { row: r }))
      // прежний вид: «Nr.bul./Data»; разделённый — «Nr.bul.», справа «Data»
      if (head(day28 + 1).includes('data')) splits.push({ column: day28 + 1, title: firstLine(raw(day28)), withValue: false })
      else if (!head(day28 + 2).startsWith('data')) throw new MessageError(message('laborator.layout', { row: r }))
      return { sheet: index, header: r, decofr, day28, splits: splits.sort((a, b) => a.column - b.column) }
    }
  }
  throw new MessageError(message('laborator.noHeader', { rows: HEADER_ROWS }))
}
