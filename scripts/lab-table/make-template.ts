/**
 * Пустой шаблон журнала проб из настоящего журнала: тот же лист, шапка, стили, ширины,
 * объединения, фильтр и заранее размеченные строки — без данных. Нужен тестам
 * (`tests/fixtures/Probe otel.xlsx`); приложение само таблиц не создаёт — пустой журнал, если он
 * понадобится, кладут на сетевой диск или в Drive вручную.
 *
 * Запуск: `npx tsx --tsconfig tsconfig.app.json scripts/lab-table/make-template.ts "<журнал>.xlsx" "<шаблон>.xlsx"`.
 * Берётся самый новый лист-год; остальные листы удаляются. Все строки данных получают
 * оформление первой строки данных (в журнале оно местами разное — цвет по заводу и т. п.).
 */
import { readFile, writeFile } from 'node:fs/promises'
import ExcelJS from 'exceljs'
import { findLabLayout } from '../../src/features/uploads/xlsx/labTableLayout'
import { cellText } from '../../src/features/uploads/xlsx/tableCell'

const [source, target] = process.argv.slice(2)
if (!source || !target) {
  console.error('usage: make-template.ts <journal.xlsx> <template.xlsx>')
  process.exit(1)
}

const workbook = new ExcelJS.Workbook()
await workbook.xlsx.load(await readFile(source))
const years = workbook.worksheets.filter((sheet) => /^\d{4}$/.test(sheet.name)).sort((a, b) => b.name.localeCompare(a.name))
const sheet = years[0]
if (!sheet) throw new Error('no year sheet')
for (const other of workbook.worksheets) if (other !== sheet) workbook.removeWorksheet(other.id)

// Читаем без `getCell`: он создал бы пустые ячейки шапки со стилем колонки.
const findCell = (row: number, column: number) => (sheet as unknown as { findCell(r: number, c: number): ExcelJS.Cell | undefined }).findCell(row, column)
const layout = findLabLayout((row, column) => cellText(findCell(row, column)?.value ?? null))
if (!layout) throw new Error(`no journal header on sheet ${sheet.name}`)

// Размеченные строки — до конца автофильтра (в журнале он заканчивается на последней размеченной строке).
const filterEnd = typeof sheet.autoFilter === 'string' ? Number(/(\d+)$/.exec(sheet.autoFilter)?.[1]) : NaN
const lastStyled = Number.isFinite(filterEnd) ? filterEnd : sheet.rowCount
const pattern = sheet.getRow(layout.dataStart)
const styles = new Map<number, unknown>()
for (let column = 1; column <= sheet.columnCount; column++) styles.set(column, JSON.parse(JSON.stringify(pattern.getCell(column).style ?? {})))

for (let row = layout.dataStart; row <= sheet.rowCount; row++) {
  const current = sheet.getRow(row)
  for (let column = 1; column <= sheet.columnCount; column++) {
    const cell = current.getCell(column)
    cell.value = null
    if (row <= lastStyled) cell.style = JSON.parse(JSON.stringify(styles.get(column)))
  }
  current.height = pattern.height
  current.commit()
}
// Ширина ровно 9 у ExcelJS считается «по умолчанию» и не сохраняется (см. `LabelWorkbook.open`).
for (const column of sheet.columns ?? []) if (column.width === 9) column.width = 9 + 1e-6
sheet.views = [{ state: 'normal', activeCell: `C${layout.dataStart}` }]
workbook.views = [{ x: 0, y: 0, width: 29040, height: 15720, firstSheet: 0, activeTab: 0, visibility: 'visible' }]

await writeFile(target, new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer))
console.log(`${sheet.name}: header rows ${layout.headerTop}-${layout.dataStart - 1}, styled rows ${layout.dataStart}-${lastStyled}`)
