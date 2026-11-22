/**
 * Первые строки листов книги — без разбора всей книги, как `StorageService.visibleSheets`: из XML листа берутся
 * строки до `rows`, тексты — из общих строк книги (`xl/sharedStrings.xml`). Главному процессу так хватает
 * миллисекунд даже на большую таблицу (ExcelJS разбирал бы её целиком и останавливал окно).
 *
 * Нужно проверке структуры таблицы на вкладке «Хранилище»: шапку по этим строкам находит та же функция,
 * что и у движка (`engine/laborator/LabHeader`).
 */
import JSZip from 'jszip'
import type { SheetHead } from '@/engine/laborator/LabHeader'

/** Сущности XML в тексте ячейки. */
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** Текст XML без сущностей: «&amp;» → «&», «&#10;» → перенос строки. */
const unescape = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, code: string) => {
    if (code[0] === '#') return String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
    return ENTITIES[code] ?? all
  })

/** Текст строки с форматированием: все `<t>`, кроме фонетических подсказок (`<rPh>`). */
const richText = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1]!)).join('')

/** Значение атрибута тега. */
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null

/** Номер колонки по адресу ячейки: «H5» → 8. */
const columnOf = (ref: string) => [...(/^[A-Z]+/.exec(ref)?.[0] ?? '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)

/** Путь части книги по ссылке из `workbook.xml.rels`: «worksheets/sheet1.xml» или «/xl/worksheets/sheet1.xml». */
const partPath = (target: string) => (target.startsWith('/') ? target.slice(1) : `xl/${target}`)

/** Первые `rows` строк каждого листа книги (по порядку листов). */
export async function workbookHead(bytes: Uint8Array, rows: number): Promise<SheetHead[]> {
  const zip = await JSZip.loadAsync(bytes)
  const read = (name: string) => zip.file(name)?.async('string') ?? Promise.resolve('')
  const [workbook, rels, shared] = await Promise.all([read('xl/workbook.xml'), read('xl/_rels/workbook.xml.rels'), read('xl/sharedStrings.xml')])
  const strings = [...shared.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => richText(m[1]!))
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id') ?? '', attr(m[0], 'Target') ?? '']))
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: unescape(attr(m[0], 'name') ?? ''), target: targets.get(attr(m[0], 'r:id') ?? '') ?? '' }))
  return Promise.all(sheets.map(async ({ name, target }) => ({ name, rows: target ? sheetHead(await read(partPath(target)), strings, rows) : new Map() })))
}

/** Первые `limit` строк XML листа: строка → колонка → текст. */
function sheetHead(xml: string, strings: readonly string[], limit: number): Map<number, Map<number, string>> {
  const out = new Map<number, Map<number, string>>()
  // номер строки и адрес ячейки в файле необязательны: без них — следующие по порядку
  let r = 0
  for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    r = Number(attr(row[1]!, 'r') ?? r + 1)
    if (r > limit) break
    const cells = new Map<number, string>()
    let c = 0
    for (const cell of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cell[1]!
      const body = cell[2] ?? ''
      const ref = attr(tag, 'r')
      c = ref ? columnOf(ref) : c + 1
      const type = attr(tag, 't')
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      const text = type === 's' ? strings[Number(value)] : type === 'inlineStr' ? richText(body) : value === undefined ? undefined : unescape(value)
      if (text) cells.set(c, text)
    }
    if (cells.size) out.set(r, cells)
  }
  return out
}
