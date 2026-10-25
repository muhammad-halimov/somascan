/**
 * Запись ID в колонку «ID sync» листа Consum прямой правкой XML внутри .xlsx.
 *
 * Consum — рабочая таблица операторов с формулами и внешними связями; пересохранение через ExcelJS могло бы их
 * испортить. Поэтому меняется только XML одного листа (ячейки колонки ID, её объединение и видимость) и
 * добавляются новые стили в styles.xml — всё остальное остаётся байт-в-байт.
 *
 * Колонка оформляется как часть таблицы: шапка — стилем «TOTAL/ELEMENT» (образец), объединена так же; строки
 * под шапкой — как у образца; ячейки с ID — единым стилем (самым частым среди уже заполненных); пустые
 * строки таблицы тоже в рамке. Колонка скрыта.
 *
 * РИСК: правка XML регулярными выражениями рассчитана на файлы, сохранённые Excel / ONLYOFFICE
 * (атрибут `r` у каждой ячейки и строки). Файл без них может не найти строки — такие ID попадают в `skipped`.
 */
import fs from 'node:fs'
import JSZip from 'jszip'
import { columnLetters, columnNumber } from '../Cells'
import type { IdColumnLook } from './ConsumBook'

/** Экранирование текста для XML. */
const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Путь к XML листа по его имени. */
async function sheetPath(zip: JSZip, sheetName: string): Promise<string> {
  const wbXml = await zip.file('xl/workbook.xml')!.async('string')
  const nameRe = new RegExp(`name="${esc(sheetName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)
  const tag = [...wbXml.matchAll(/<sheet\b[^>]*>/g)].map((x) => x[0]).find((t) => nameRe.test(t))
  if (!tag) throw new Error(`лист «${sheetName}» не найден`)
  const rid = tag.match(/r:id="([^"]+)"/)![1]
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((x) => x[0]).find((t) => t.includes(`Id="${rid}"`))!
  const target = rel.match(/Target="([^"]+)"/)![1]!
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`
}

/** Новый стиль ячейки для styles.xml. */
interface StyleSpec {
  bold?: boolean
  size?: number
  color?: string
  fill?: string
  border: 'thin' | 'medium'
  wrap?: boolean
  h?: 'left' | 'center'
}

/** Добавляет в styles.xml шрифты, заливки, рамки и форматы ячеек; возвращает атрибуты ` s="N"` новых форматов. */
async function addStyles(zip: JSZip, specs: StyleSpec[]): Promise<string[]> {
  let st = await zip.file('xl/styles.xml')!.async('string')
  const grow = (tag: string, item: string) => {
    const m = new RegExp(`<${tag}( [^>]*?)?count="(\\d+)"([^>]*)>`).exec(st)
    if (!m) throw new Error(`styles.xml: нет <${tag}>`)
    const n = Number(m[2])
    st = st.replace(m[0], `<${tag}${m[1] ?? ''}count="${n + 1}"${m[3]}>`).replace(`</${tag}>`, item + `</${tag}>`)
    return n
  }
  const out: string[] = []
  for (const sp of specs) {
    const font = grow('fonts', `<font>${sp.bold ? '<b/>' : ''}<sz val="${sp.size ?? 10}"/><color rgb="${sp.color ?? 'FF000000'}"/><name val="Arial"/><family val="2"/></font>`)
    const fill = sp.fill ? grow('fills', `<fill><patternFill patternType="solid"><fgColor rgb="${sp.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0
    const b = '<color rgb="FF000000"/>'
    const side = (n: string) => `<${n} style="${sp.border}">${b}</${n}>`
    const border = grow('borders', `<border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border>`)
    const xf = grow('cellXfs', `<xf numFmtId="0" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="${sp.h ?? 'center'}" vertical="center"${sp.wrap ? ' wrapText="1"' : ''}/></xf>`)
    out.push(` s="${xf}"`)
  }
  zip.file('xl/styles.xml', st)
  return out
}

/** Что записать. */
export interface PatchIdsOptions {
  sheetName: string
  /** Номер колонки ID. */
  col: number
  /** Шапку нужно вписать (её ещё нет); `null` — шапка уже есть. */
  header: { row: number; text: string } | null
  /** ID по строкам: номер строки → ID. */
  ids: ReadonlyMap<number, string>
  look: IdColumnLook
}

/** Итог правки. */
export interface PatchIdsResult {
  /** Новые байты файла или `null`, если ничего не изменилось. */
  buffer: Uint8Array | null
  written: number
  /** Строки, куда ID не записан (ячейка занята другим значением или строки нет). */
  skipped: number[]
}

/** Как прошла правка одной ячейки. */
type UpsertStatus = 'norow' | 'noop' | 'styled' | 'written' | 'skipped'

/** Вписывает ID и оформляет колонку. */
export async function patchIds(file: string, { sheetName, col, header, ids, look }: PatchIdsOptions): Promise<PatchIdsResult> {
  const zip = await JSZip.loadAsync(fs.readFileSync(file))
  const p = await sheetPath(zip, sheetName)
  let xml = await zip.file(p)!.async('string')
  const xml0 = xml
  const L = columnLetters(col)
  const sOf = (attrs: string) => (attrs.match(/\ss="\d+"/) ?? [''])[0]!
  const hasValue = (inner: string | undefined) => !!inner && (/<f[ >/]/.test(inner) || /<v>[^<]+<\/v>/.test(inner) || /<t[^>]*>[^<]+<\/t>/.test(inner))
  const cellRe = (c: string, r: number) => new RegExp(`<c r="${c}${r}"([^>]*?)(/>|>([\\s\\S]*?)</c>)`)
  const inline = (r: number, value: string, sAttr: string) => `<c r="${L}${r}"${sAttr} t="inlineStr"><is><t>${esc(value)}</t></is></c>`

  // единый стиль ячеек ID: самый частый среди уже заполненных ячеек колонки
  const counts = new Map<string, number>()
  for (const m of xml.matchAll(new RegExp(`<c r="${L}(\\d+)"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`, 'g'))) {
    if (Number(m[1]) >= 10 && hasValue(m[3])) {
      const sa = sOf(m[2]!)
      if (sa) counts.set(sa, (counts.get(sa) ?? 0) + 1)
    }
  }
  let dataS = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''

  /** Записывает или оформляет ячейку колонки в строке `r`; `value = null` — только оформление. */
  function upsert(r: number, value: string | null, sAttr: string | undefined, force = false): UpsertStatus {
    const mo = new RegExp(`<row r="${r}"(?=[\\s>/])[^>]*?(/?)>`).exec(xml)
    if (!mo) return 'norow'
    const open = mo[0]
    const start = mo.index
    if (mo[1] === '/') {
      // пустая строка <row … /> — раскрываем
      if (value == null && !sAttr) return 'noop'
      const c = value == null ? `<c r="${L}${r}"${sAttr}/>` : inline(r, value, sAttr ?? '')
      xml = xml.slice(0, start) + open.replace(/\/>$/, '>') + c + '</row>' + xml.slice(start + open.length)
      return value == null ? 'styled' : 'written'
    }
    const end = xml.indexOf('</row>', start)
    const body = xml.slice(start + open.length, end)
    const em = cellRe(L, r).exec(body)
    let newBody: string
    let status: UpsertStatus
    if (em) {
      const occupied = hasValue(em[3])
      if (value != null && (!occupied || force)) {
        newBody = body.slice(0, em.index) + (value === '' ? `<c r="${L}${r}"${sAttr ?? sOf(em[1]!)}/>` : inline(r, value, sAttr ?? sOf(em[1]!))) + body.slice(em.index + em[0].length)
        status = 'written'
      } else {
        const sFinal = sAttr !== undefined ? sAttr : sOf(em[1]!)
        newBody = body.slice(0, em.index) + `<c r="${L}${r}"${em[1]!.replace(/\ss="\d+"/, '')}${sFinal}${em[2]}` + body.slice(em.index + em[0].length)
        status = value != null && occupied ? 'skipped' : 'styled'
      }
    } else {
      // вставляем в нужное место по порядку колонок
      let at = body.length
      for (const m of body.matchAll(/<c r="([A-Z]+)\d+"/g)) {
        if (columnNumber(m[1]!) > col) { at = m.index!; break }
      }
      let prevS = ''
      for (const m of body.slice(0, at).matchAll(/<c r="[A-Z]+\d+"([^>]*?)\/?>/g)) prevS = sOf(m[1]!)
      const s = sAttr ?? prevS
      if (value == null && !s) return 'noop'
      newBody = body.slice(0, at) + (value == null ? `<c r="${L}${r}"${s}/>` : inline(r, value, s)) + body.slice(at)
      status = value == null ? 'styled' : 'written'
    }
    const newOpen = open.replace(/spans="(\d+):(\d+)"/, (_m0, a1: string, b1: string) => `spans="${Math.min(Number(a1), col)}:${Math.max(Number(b1), col)}"`)
    xml = xml.slice(0, start) + newOpen + newBody + xml.slice(end)
    return status
  }

  // шапка: стилем образца (TOTAL/ELEMENT), объединена по вертикали (top…bottom), «ID sync» внутри
  const top = look.mergeTop || 6
  const bottom = look.mergeBottom || 8
  const styles = await addStyles(zip, [
    { bold: true, color: 'FFFFFFFF', fill: 'FFE8392B', border: 'medium', wrap: true },
    { border: 'thin' },
    { fill: 'FFDDFFFF', border: 'thin', h: 'left' },
  ])
  let hdrS = styles[0]!
  const r9S = styles[1]!
  const cyanS = styles[2]!
  if (!dataS) dataS = cyanS
  const Ld = look.donor ? columnLetters(look.donor) : null
  const donorS = (r: number) => {
    if (!Ld) return r9S
    const m = cellRe(Ld, r).exec(xml)
    return m ? sOf(m[1]!) : r9S
  }
  if (Ld) {
    const m = cellRe(Ld, top).exec(xml)
    const ds = m ? sOf(m[1]!) : ''
    if (ds) hdrS = ds
  }
  const keep = new Set<number>()
  for (let r = top; r <= bottom; r++) keep.add(r)
  // прежние объединения другой высоты снимаем, их ячейки — как у образца
  for (const ref of look.oldMerges) {
    const tag = `<mergeCell ref="${ref}"/>`
    if (!xml.includes(tag)) continue
    xml = xml.replace(tag, '').replace(/<mergeCells count="(\d+)">/, (_m, n: string) => `<mergeCells count="${Number(n) - 1}">`)
    const [, r1, r2] = /^[A-Z]+(\d+):[A-Z]+(\d+)$/.exec(ref) ?? []
    for (let r = Number(r1); r <= Number(r2); r++) if (!keep.has(r)) upsert(r, '', donorS(r), true)
  }
  for (let r = top; r <= bottom; r++) upsert(r, r === top ? (header ? header.text : 'ID sync') : '', hdrS, true)
  for (const r of look.below) upsert(r, '', donorS(r), true)
  if (!new RegExp(`<mergeCell ref="${L}${top}:${L}${bottom}"`).test(xml)) {
    if (/<mergeCells count="\d+">/.test(xml)) xml = xml.replace(/<mergeCells count="(\d+)">/, (_m, n: string) => `<mergeCells count="${Number(n) + 1}"><mergeCell ref="${L}${top}:${L}${bottom}"/>`)
    else xml = xml.replace('</sheetData>', `</sheetData><mergeCells count="1"><mergeCell ref="${L}${top}:${L}${bottom}"/></mergeCells>`)
  }

  // сами ID
  let written = 0
  const skipped: number[] = []
  for (const [r, value] of [...ids].sort((a, b) => a[0] - b[0])) {
    const st = upsert(r, value, dataS || undefined)
    if (st === 'written') written++
    else if (st === 'skipped' || st === 'norow') skipped.push(r)
  }
  // квадраты везде: пустые ячейки строк таблицы тоже в рамке
  if (dataS) for (const r of look.fillRows) upsert(r, null, dataS)
  // единый вид всех ID в колонке
  if (dataS) {
    xml = xml.replace(new RegExp(`<c r="${L}(\\d+)"([^>]*?)(/>|>([\\s\\S]*?)</c>)`, 'g'), (m, r: string, attrs: string, rest: string, inner: string | undefined) =>
      Number(r) >= 10 && hasValue(inner) && sOf(attrs) !== dataS ? `<c r="${L}${r}"${attrs.replace(/\ss="\d+"/, '')}${dataS}${rest}` : m)
  }

  // границы листа (dimension)
  xml = xml.replace(/<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/, (_m0, a: string, b: string, c: string, d: string) => `<dimension ref="${a}${b}:${columnLetters(Math.max(columnNumber(c), col))}${d}"/>`)
  xml = hideColumn(xml, col)

  zip.file(p, xml)
  const buf = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  return { buffer: xml === xml0 ? null : buf, written, skipped }
}

/** Скрывает колонку в `<cols>`: делит диапазон, если колонка в нём, или добавляет свою запись. */
function hideColumn(xml: string, col: number): string {
  const hidCol = `<col min="${col}" max="${col}" width="11" hidden="1" customWidth="1"/>`
  const colsM = /<cols>([\s\S]*?)<\/cols>/.exec(xml)
  if (!colsM) return xml.replace('<sheetData', `<cols>${hidCol}</cols><sheetData`)
  const out: string[] = []
  let done = false
  for (const it of colsM[1]!.match(/<col\b[^>]*?\/>/g) ?? []) {
    const mn = Number(/min="(\d+)"/.exec(it)![1])
    const mx = Number(/max="(\d+)"/.exec(it)![1])
    if (col < mn || col > mx) {
      out.push(it)
      continue
    }
    const rng = (x: number, y: number) => it.replace(/min="\d+"/, `min="${x}"`).replace(/max="\d+"/, `max="${y}"`)
    if (mn < col) out.push(rng(mn, col - 1))
    const mid = rng(col, col)
    out.push(/hidden="/.test(mid) ? mid.replace(/hidden="[^"]*"/, 'hidden="1"') : mid.replace(/\/>$/, ' hidden="1"/>'))
    if (col < mx) out.push(rng(col + 1, mx))
    done = true
  }
  if (!done) out.push(hidCol)
  out.sort((x, y) => Number(/min="(\d+)"/.exec(x)![1]) - Number(/min="(\d+)"/.exec(y)![1]))
  return xml.replace(colsM[0], `<cols>${out.join('')}</cols>`)
}
