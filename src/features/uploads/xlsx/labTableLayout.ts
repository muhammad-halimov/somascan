/**
 * Раскладка журнала проб стали («Probe Otel pentru Laborator»): по одному листу на год,
 * над данными — шапка из нескольких строк с объединёнными ячейками:
 *
 * ```
 * Nr. Crt. | Cantitatea | Data trimetere la incercat | Data intrare | Sarja | Producator | BST 500: Ø Bobina | Ø Bara | Doc. de calitate
 * ```
 *
 * Колонки ищутся по тексту шапки (без учёта регистра, диакритики и лишних пробелов), а не по буквам:
 * таблицу могут переставить, переименовать колонку в известный вариант или добавить свою колонку —
 * колонка с названием включённого поля бирки тоже заполняется. «Data trimetere la incercat»
 * (дата отправки на испытание) заполняет лаборатория — приложение её не трогает.
 */
import { normalizeHeader } from './tableCell'

/** Колонка журнала, которую знает приложение. */
export type LabColumnKind =
  /** «Nr. Crt.» — порядковый номер строки. */
  | 'number'
  /** «Cantitatea» — вес, как в журнале: `8126Kg`. */
  | 'quantity'
  /** «Data trimetere la incercat» — заполняет лаборатория, приложение не пишет. */
  | 'sentToTest'
  /** «Data intrare» — дата поступления: день записи в таблицу. */
  | 'arrivalDate'
  /** «Sarja» — номер плавки. */
  | 'heat'
  /** «Producator» — завод-производитель. */
  | 'producer'
  /** «Ø Bobina» — диаметр, если металл в катушке. */
  | 'coil'
  /** «Ø Bara» — диаметр, если металл в прутках. */
  | 'bar'
  /** «Doc. de calitate» — документ качества (необязательное поле бирки). */
  | 'qualityDoc'

/** Как узнать колонку по нормализованному тексту шапки (без диакритики, в нижнем регистре). */
const KNOWN_HEADERS: ReadonlyArray<readonly [LabColumnKind, RegExp]> = [
  ['number', /^(nr\.?\s*crt\.?|nr\.?|no\.?)$/],
  ['quantity', /^cantitate[a]?\b/],
  ['sentToTest', /^data trim[ei]ter(e|ea|ii) la incercat/],
  ['arrivalDate', /^data (intrare|intrarii|sosire|sosirii)\b/],
  ['heat', /^sarja?\b/],
  ['producer', /^producator\b/],
  ['coil', /^bobina?$/],
  ['bar', /^bara?$/],
  ['qualityDoc', /^(doc\.?|documente?|acte) de calitate\b/],
]

/** Сколько строк сверху просматривается в поисках шапки. */
export const HEADER_SCAN_ROWS = 15

/** Сколько колонок слева просматривается в поисках шапки. */
export const HEADER_SCAN_COLUMNS = 60

/** Сколько известных колонок должно найтись, чтобы считать лист журналом. */
const MIN_KNOWN_COLUMNS = 3

/** Колонка своего поля бирки, найденная по названию в шапке. */
export interface FieldColumnHeader {
  /** Ключ поля бирки. */
  key: string
  /** Все названия поля (на всех языках, ключ). */
  aliases: readonly string[]
}

/** Найденная раскладка листа. */
export interface LabLayout {
  /** Номера колонок (с единицы) известных колонок. */
  known: ReadonlyMap<LabColumnKind, number>
  /** Номера колонок своих полей бирки по ключу поля. */
  fields: ReadonlyMap<string, number>
  /** Первая строка шапки (с единицы). */
  headerTop: number
  /** Первая строка данных — сразу под шапкой. */
  dataStart: number
  /** Самая левая и самая правая колонки таблицы (по шапке). */
  firstColumn: number
  lastColumn: number
}

/** Текст ячейки для сравнения с известными названиями: ещё и без диакритики (`Șarja` → `sarja`). */
export const plainHeader = (text: string) => normalizeHeader(text).normalize('NFD').replace(/\p{M}+/gu, '')

/** Какая известная колонка подписана этим текстом, если какая-то. */
export function knownColumnOf(text: string): LabColumnKind | null {
  const plain = plainHeader(text)
  if (plain === '') return null
  return KNOWN_HEADERS.find(([, pattern]) => pattern.test(plain))?.[0] ?? null
}

/**
 * Ищет шапку журнала на листе.
 * @param read Текст ячейки (строка и колонка с единицы); у объединённых ячеек — текст главной ячейки.
 * @param fields Свои поля бирки, колонки которых тоже ищутся по названию.
 * @returns Раскладка или `null`, если лист не похож на журнал.
 */
export function findLabLayout(read: (row: number, column: number) => string, fields: readonly FieldColumnHeader[] = []): LabLayout | null {
  const known = new Map<LabColumnKind, number>()
  const headerCells: Array<{ row: number; column: number; text: string }> = []
  let headerTop = Number.POSITIVE_INFINITY
  let headerBottom = 0
  for (let row = 1; row <= HEADER_SCAN_ROWS; row++) {
    for (let column = 1; column <= HEADER_SCAN_COLUMNS; column++) {
      const text = read(row, column)
      if (text.trim() === '') continue
      const kind = knownColumnOf(text)
      if (!kind) {
        headerCells.push({ row, column, text })
        continue
      }
      // Объединённая ячейка шапки читается в каждой строке объединения: берём первое вхождение колонки,
      // а нижнюю границу шапки — по самой нижней строке, где ещё видно название.
      if (!known.has(kind)) known.set(kind, column)
      headerTop = Math.min(headerTop, row)
      headerBottom = Math.max(headerBottom, row)
    }
  }
  if (known.size < MIN_KNOWN_COLUMNS) return null

  // Свои колонки: в пределах строк шапки, не занятые известными колонками.
  const taken = new Set(known.values())
  const fieldColumns = new Map<string, number>()
  for (const field of fields) {
    const names = new Set(field.aliases.map(plainHeader))
    const cell = headerCells.find(({ row, column, text }) =>
      row >= headerTop && row <= headerBottom && !taken.has(column) && names.has(plainHeader(text)))
    if (!cell) continue
    fieldColumns.set(field.key, cell.column)
    taken.add(cell.column)
  }
  const columns = [...taken]
  return {
    known,
    fields: fieldColumns,
    headerTop,
    dataStart: headerBottom + 1,
    firstColumn: Math.min(...columns),
    lastColumn: Math.max(...columns),
  }
}

/** Колонки, по которым видно, что в строке есть данные: все, кроме «Nr. Crt.» (номера бывают проставлены заранее). */
export function dataColumnsOf(layout: LabLayout): number[] {
  const columns = [...layout.known].filter(([kind]) => kind !== 'number').map(([, column]) => column)
  return [...columns, ...layout.fields.values()]
}
