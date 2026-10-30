/**
 * Недокументированные места ExcelJS, на которые опирается журнал, — все в одном файле.
 *
 * РИСК: это не публичный API библиотеки (`exceljs` 4.x). После обновления ExcelJS первым делом
 * прогнать `npm test` (labelWorkbook: шапка без «расписывания» пустых ячеек, новый лист года первым,
 * ширины колонок после пересохранения) и сверить настоящий журнал до и после записи (README, «Журнал проб»).
 */
import type { Cell, Workbook, Worksheet } from 'exceljs'

/** Ширина колонки, которую ExcelJS считает «по умолчанию» и потому не записывает в файл. */
const EXCELJS_DEFAULT_WIDTH = 9

/**
 * Ячейка, если она есть в файле. Публичный `getCell` создаёт недостающую ячейку со стилем колонки —
 * при чтении шапки это «расписало» бы пустые ячейки чужой таблицы. `Worksheet.findCell` есть
 * в ExcelJS, но не в его типах.
 */
export const findCell = (sheet: Worksheet, row: number, column: number): Cell | undefined =>
  (sheet as unknown as { findCell(row: number, column: number): Cell | undefined }).findCell(row, column)

/** Номер листа в порядке книги: ExcelJS хранит порядок в `orderNo`, которого нет в типах. */
const order = (sheet: Worksheet) => sheet as unknown as { orderNo: number }

/** Ставит лист первым в книге (как в журнале: листы идут от нового года к старому). */
export function moveSheetFirst(workbook: Workbook, sheet: Worksheet) {
  const first = Math.min(...workbook.worksheets.filter((other) => other !== sheet).map((other) => order(other).orderNo))
  order(sheet).orderNo = first - 1
}

/**
 * Колонку шириной ровно 9 ExcelJS принимает за ширину по умолчанию и не сохраняет — Excel показал бы
 * её чуть уже (8,43). Сдвигаем такие ширины на миллионную долю, чтобы они записались как были.
 */
export function keepDefaultWidths(workbook: Workbook) {
  for (const sheet of workbook.worksheets) {
    for (const column of sheet.columns ?? []) {
      if (column.width === EXCELJS_DEFAULT_WIDTH) column.width = EXCELJS_DEFAULT_WIDTH + 1e-6
    }
  }
}

/** Объединённые ячейки листа (`A1:B2`): в публичном API ExcelJS их списка нет, только в модели. */
export const mergedRanges = (sheet: Worksheet): string[] => (sheet.model as { merges?: string[] }).merges ?? []
