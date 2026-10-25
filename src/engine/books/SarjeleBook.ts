/**
 * Sarjele: блоки элементов, расход по плавкам и реестр ID.
 *
 * Расход плавки — сумма KG этой плавки во всех блоках всех листов. Остатки нигде не хранятся: остаток =
 * поставлено (Probe) − расход (Sarjele), поэтому ручные правки Sarjele учитываются сами.
 *
 * Для каждого блока заодно проверяется, в порядке ли оформление (служебные колонки скрыты, левая линия
 * таблицы видна): если нет — при записи файл переоформляется, даже когда по данным менять нечего.
 *
 * Блок элемента — таблица под заголовком:
 *
 *     [ID]        | Название элемента (объединено на 4 колонки)       | дата
 *     Model ID    | Model  | ø  | Sarje  | Name  | KG
 *     11040001    | Bobina | 10 | 250001 | Producător     | 750
 *
 * «Model ID» — код материала из Consum, «Model» — форма плавки (Bara / Bobina). ID блока (`NI-0004`) стоит
 * слева от названия, над «Model ID». Колонка «Model ID» и ID — служебные: скрыты или невидимы (формат `;;;`).
 *
 * Старые блоки бывают в прежнем виде: без «Model ID» (код прямо в колонке Model) или с подписями
 * Bara/Bobina слева. При записи они приводятся к итоговому виду, если слева свободно.
 *
 * РИСК: блок узнаётся по тексту шапки («Model», «ø» через одну, «KG» через четыре колонки). Переименованная
 * или сдвинутая шапка — блок не найден: элемент получит новый блок, а расход старого не учитывается в остатках.
 */
import ExcelJS from 'exceljs'
import { cellText, cellValue, emptyAt, hasAnyBorder, hasBorder, parseBlockDate, text, toNumber, type Scalar } from '../Cells'

// ── Строение блока ─────────────────────────────────────────────────────────

/** Скрытый лист реестра ID в Sarjele: ID → проект, элемент, лист, источник. */
export const REGISTRY_SHEET = 'sync-registry'

/** Формат «невидимый текст»: значение есть (видно в строке формул), на листе пусто. */
export const HIDDEN_FORMAT = ';;;'

/** ID элемента: 1–3 буквы, дефис, 4 цифры. */
export const ELEMENT_ID = /^[A-Z]{1,3}-\d{4}$/

/** Подпись формы плавки. */
export const isFormWord = (x: string): boolean => /^(bara|bobina)$/i.test(x)

/** Подписи шапки блока после «Model»: ø, Sarje, Name, KG. */
const HEADER_TAIL = ['ø', 'Sarje', 'Name', 'KG'] as const

/** Шапка блока (с KG) в строке `r` начиная с колонки `c` («Model» или «Model ID» в `c`). */
export function isBlockHeaderAt(ws: ExcelJS.Worksheet, r: number, c: number): boolean {
  const head = cellValue(ws.getCell(r, c))
  if (head !== 'Model' && head !== 'Model ID') return false
  return HEADER_TAIL.every((h, i) => cellText(ws.getCell(r, c + 1 + i)) === h)
}

/** Шапка блока итогового вида: «Model» в `c`, дальше ø … KG (для оформления и скрытия). */
export function isModelHeaderAt(ws: ExcelJS.Worksheet, r: number, c: number): boolean {
  return r >= 2 && cellValue(ws.getCell(r, c)) === 'Model' && cellText(ws.getCell(r, c + 1)) === 'ø' && cellText(ws.getCell(r, c + 4)) === 'KG'
}

/**
 * Вид блока по тому, что слева от него:
 *   - `final` — «Model ID | Model» уже есть;
 *   - `transitional` — слева подписи Bara/Bobina (прежний вид);
 *   - `migrate` — слева свободно, можно перейти к итоговому виду;
 *   - `plain` — слева занято чужим (или блок в колонке A), остаётся как есть.
 */
export type BlockState = 'final' | 'transitional' | 'migrate' | 'plain'

/** Вид блока и строки его данных. */
export interface BlockClass {
  state: BlockState
  dataRows: number[]
  /** В колонке Model уже стоят формы (Bara/Bobina). */
  formAtC?: boolean
}

/** Определяет вид блока с шапкой в строке `r`, колонке `c` (`head` — подпись шапки в `c`). */
export function classifyBlock(ws: ExcelJS.Worksheet, r: number, c: number, head: unknown): BlockClass {
  const dataRows: number[] = []
  for (let rr = r + 1; !emptyAt(ws, rr, c, 5); rr++) dataRows.push(rr)
  if (c < 2) return { state: 'plain', dataRows }
  const leftHdr = cellText(ws.getCell(r, c - 1))
  if (head === 'Model' && leftHdr === 'Model ID') return { state: 'final', dataRows }
  const lefts = dataRows.map((rr) => cellText(ws.getCell(rr, c - 1)))
  const formAtC = dataRows.some((rr) => isFormWord(cellText(ws.getCell(rr, c))))
  const t0 = cellText(ws.getCell(r - 1, c - 1))
  if (t0 && !ELEMENT_ID.test(t0)) return { state: 'plain', dataRows, formAtC }
  const onlyForms = lefts.every((x) => !x || isFormWord(x))
  if (head === 'Model ID' && leftHdr === 'Model' && onlyForms) return { state: 'transitional', dataRows, formAtC }
  if (!leftHdr && lefts.every((x) => !x)) return { state: 'migrate', dataRows, formAtC }
  if (head === 'Model' && !leftHdr && !formAtC && onlyForms && lefts.some(isFormWord)) return { state: 'transitional', dataRows, formAtC }
  return { state: 'plain', dataRows, formAtC }
}

/** Кэш `modelIdColumnOnly` на лист (пересчитывается для каждой открытой книги). */
const modelIdCache = new WeakMap<ExcelJS.Worksheet, Map<number, boolean>>()

/**
 * Можно ли скрыть колонку «Model ID» целиком: в ней нет ничего, кроме блоков (ID над шапкой, «Model ID», коды),
 * и рядом нет блоков старого вида.
 */
export function modelIdColumnOnly(ws: ExcelJS.Worksheet, col: number): boolean {
  let cache = modelIdCache.get(ws)
  if (!cache) modelIdCache.set(ws, (cache = new Map()))
  const known = cache.get(col)
  if (known !== undefined) return known
  const result = computeModelIdOnly(ws, col)
  cache.set(col, result)
  return result
}

/** Расчёт для `modelIdColumnOnly`. */
function computeModelIdOnly(ws: ExcelJS.Worksheet, col: number): boolean {
  // рядом блок старого вида
  for (let r = 1; r <= ws.rowCount; r++) if (cellText(ws.getCell(r, col + 1)) === 'Model' && cellText(ws.getCell(r, col)) !== 'Model ID') return false
  const ok = new Set<number>()
  for (let r = 1; r <= ws.rowCount; r++) {
    if (cellText(ws.getCell(r, col)) !== 'Model ID' || cellText(ws.getCell(r, col + 1)) !== 'Model') continue
    ok.add(r)
    if (r > 1) ok.add(r - 1)
    for (let rr = r + 1; rr <= ws.rowCount && !emptyAt(ws, rr, col, 6); rr++) ok.add(rr)
  }
  if (!ok.size) return false
  for (let r = 1; r <= ws.rowCount; r++) if (!ok.has(r) && cellValue(ws.getCell(r, col)) != null) return false
  return true
}

/** Строки блока от заголовка до последней строки данных: заголовок, шапка и строки, пока они не пусты. */
export function* blockRows(ws: ExcelJS.Worksheet, headerRow: number, col: number): Generator<number> {
  for (let rr = headerRow - 1; rr === headerRow - 1 || rr === headerRow || !emptyAt(ws, rr, col, 5); rr++) yield rr
}

// ── Чтение ──────────────────────────────────────────────────────────────────

/** Строка блока. */
export interface BlockRow {
  /** Номер строки на листе. */
  r: number
  /** Код материала (Model ID). */
  model: Scalar
  dia: Scalar
  sarja: string
  /** Производитель (Name). */
  name: string
  kg: number | null
  /** Форма плавки, как подписана в блоке. */
  label: string
  /** Строка уже занята при дозаполнении (служебное). */
  used?: boolean
}

/** Блок элемента. */
export interface Block {
  sheet: string
  title: string
  titleRow: number
  headerRow: number
  /** Колонка «Model». */
  col: number
  /** ID элемента (слева от названия или прежнее место справа). */
  id: string
  date: Date | null
  rows: BlockRow[]
  /** Итоговый вид: слева «Model ID» (код). */
  codeLeft: boolean
  final: boolean
  plain: boolean
  /** ID стоит слева от названия. */
  idLeft: boolean
  /** ID скрыт (формат `;;;`) или его нет. */
  idHidden: boolean
  /** Слева оформлено (рамка или невидимый формат). */
  leftStyled: boolean
  layoutOk: boolean
  /** Левая линия таблицы не видна или в скрытой колонке остались рамки. */
  noLeft: boolean
  /** «Model ID» виден (не скрыт / есть рамки). */
  modelIdVisible: boolean
  /** Колонку «Model ID» нужно скрыть или показать. */
  modelIdHide: boolean
  /** Свободных строк под блоком (для доп. строк). */
  room: number
}

/** Запись реестра ID. */
export interface RegistryEntry {
  id: string
  project: string
  name: string
  sheet: string
  source: string
  period: string
}

/** Кто и когда списывал плавку (для правила «с последней использованной»). */
export interface HeatEvent {
  /** «Ø|форма». */
  key: string
  sarja: string
  date: Date | null
  seq: number
}

/** Есть ли у ячейки скрытой колонки рамки, мешающие соседней линии. */
function hiddenColumnHasBorders(ws: ExcelJS.Worksheet, r: number, c: number): boolean {
  if (c <= 1 || !ws.getColumn(c - 1).hidden) return false
  for (let rr = r - 1; rr <= r + 60 && (rr <= r || !emptyAt(ws, rr, c, 5)); rr++) if (hasAnyBorder(ws.getCell(rr, c - 1))) return true
  return false
}

/** Видна ли левая линия таблицы во всех строках блока. */
function leftEdgeMissing(ws: ExcelJS.Worksheet, r: number, c: number): boolean {
  let vc = c - 1
  while (vc >= 1 && ws.getColumn(vc).hidden) vc--
  for (let rr = r - 1; rr <= r + 60 && (rr <= r || !emptyAt(ws, rr, c, 5)); rr++) {
    if (!hasBorder(ws.getCell(rr, c), 'left') || (vc >= 1 && vc < c - 1 && !hasBorder(ws.getCell(rr, vc), 'right'))) return true
  }
  return false
}

/** Читает блок с шапкой в (`r`, `c`). */
function readBlock(ws: ExcelJS.Worksheet, r: number, c: number, head: Scalar, used: Map<string, number>, events: HeatEvent[], seq: { n: number }): Block {
  const idLeftText = c > 1 ? cellText(ws.getCell(r - 1, c - 1)) : ''
  // ID слева от названия; прежнее место (справа) читаем и переносим
  const idText = ELEMENT_ID.test(idLeftText) ? idLeftText : cellText(ws.getCell(r - 1, c + 5))
  const cls = classifyBlock(ws, r, c, head)
  const codeLeft = cls.state === 'final'
  const idCell = ELEMENT_ID.test(idLeftText) ? ws.getCell(r - 1, c - 1) : ws.getCell(r - 1, c + 5)
  const headLeft = c > 1 ? ws.getCell(r, c - 1) : null
  const titleLeftOk = !!ws.getCell(r, c).border?.left?.style && !!ws.getCell(r - 1, c).border?.left?.style
  const b: Block = {
    sheet: ws.name,
    title: cellText(ws.getCell(r - 1, c)),
    titleRow: r - 1,
    headerRow: r,
    col: c,
    id: ELEMENT_ID.test(idText) ? idText : '',
    date: parseBlockDate(cellValue(ws.getCell(r - 1, c + 4))),
    rows: [],
    codeLeft,
    final: false,
    plain: false,
    idLeft: ELEMENT_ID.test(idLeftText),
    idHidden: !ELEMENT_ID.test(idText) || idCell.numFmt === HIDDEN_FORMAT,
    leftStyled: c > 1 && (!!headLeft!.border?.bottom?.style || headLeft!.numFmt === HIDDEN_FORMAT),
    layoutOk: false,
    noLeft: leftEdgeMissing(ws, r, c) || hiddenColumnHasBorders(ws, r, c) || !ws.getCell(r, c).border?.left?.style || (r > 1 && !ws.getCell(r - 1, c).border?.left?.style),
    modelIdVisible: codeLeft && (!titleLeftOk || headLeft!.numFmt !== HIDDEN_FORMAT || !!headLeft!.border?.right?.style || !!headLeft!.border?.bottom?.style),
    modelIdHide: codeLeft && (c === 2
      ? !!ws.getColumn(1).hidden || (modelIdColumnOnly(ws, 1) && ws.getColumn(1).width !== 2)
      : !!ws.getColumn(c - 1).hidden !== modelIdColumnOnly(ws, c - 1)),
    room: 0,
  }
  for (let rr = r + 1; ; rr++) {
    const v = [0, 1, 2, 3, 4].map((i) => cellValue(ws.getCell(rr, c + i)))
    if (v.every((x) => x == null)) break
    const code = codeLeft ? cellValue(ws.getCell(rr, c - 1)) : v[0]!
    // форма: колонка Model, а в переходном виде — подпись слева
    const form = codeLeft || /^(bara|bobina)$/i.test(text(v[0])) ? text(v[0]) : cls.state === 'transitional' ? cellText(ws.getCell(rr, c - 1)) : ''
    if (codeLeft && code != null && (ws.getCell(rr, c - 1).numFmt !== HIDDEN_FORMAT || !!ws.getCell(rr, c - 1).border?.right?.style)) b.modelIdVisible = true
    b.rows.push({ r: rr, model: code, dia: v[1]!, sarja: text(v[2]), name: text(v[3]), kg: toNumber(v[4]), label: form })
    const kg = toNumber(v[4])
    if (text(v[2]) && kg) {
      used.set(text(v[2]), (used.get(text(v[2])) ?? 0) + kg)
      const heatForm = /bob/i.test(form) ? 'Bobina' : /bar/i.test(form) ? 'Bara' : null
      if (heatForm && toNumber(v[1])) events.push({ key: `${toNumber(v[1])}|${heatForm}`, sarja: text(v[2]), date: b.date, seq: seq.n++ })
    }
  }
  b.final = codeLeft && head === 'Model'
  b.plain = cls.state === 'plain'
  b.layoutOk = b.plain || (b.final && b.leftStyled)
  let room = 0
  while (room < 80 && [0, 1, 2, 3, 4].every((i) => cellValue(ws.getCell(r + 1 + b.rows.length + room, c + i)) == null)) room++
  b.room = room
  return b
}

/** Читает реестр ID. */
function readRegistry(wb: ExcelJS.Workbook): { registry: Map<string, RegistryEntry>; state: string } {
  const registry = new Map<string, RegistryEntry>()
  const rg = wb.getWorksheet(REGISTRY_SHEET)
  if (rg) {
    for (let r = 2; r <= rg.rowCount; r++) {
      const id = cellText(rg.getCell(r, 1))
      if (id) registry.set(id, { id, project: cellText(rg.getCell(r, 2)), name: cellText(rg.getCell(r, 3)), sheet: cellText(rg.getCell(r, 4)), source: cellText(rg.getCell(r, 7)), period: cellText(rg.getCell(r, 8)) })
    }
  }
  return { registry, state: rg?.state ?? '' }
}

/** Прочитанный Sarjele. */
export class SarjeleBook {
  readonly blocks: Block[]
  /** Расход по плавкам: плавка → кг. */
  readonly used: Map<string, number>
  /** Кто и когда списывал плавки. */
  readonly events: HeatEvent[]
  readonly registry: Map<string, RegistryEntry>
  /** Видимость листа реестра. */
  readonly registryState: string
  readonly sheets: string[]

  private constructor(data: Pick<SarjeleBook, 'blocks' | 'used' | 'events' | 'registry' | 'registryState' | 'sheets'>) {
    this.blocks = data.blocks
    this.used = data.used
    this.events = data.events
    this.registry = data.registry
    this.registryState = data.registryState
    this.sheets = data.sheets
  }

  /** Читает Sarjele. */
  static async read(file: string): Promise<SarjeleBook> {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(file)
    const blocks: Block[] = []
    const used = new Map<string, number>()
    const events: HeatEvent[] = []
    const seq = { n: 0 }
    for (const ws of wb.worksheets) {
      ws.eachRow((row, r) => {
        row.eachCell((cell, c) => {
          const head = cellValue(cell)
          if (!isBlockHeaderAt(ws, r, c)) return
          blocks.push(readBlock(ws, r, c, head, used, events, seq))
        })
      })
    }
    const { registry, state } = readRegistry(wb)
    return new SarjeleBook({ blocks, used, events, registry, registryState: state, sheets: wb.worksheets.map((w) => w.name) })
  }
}
