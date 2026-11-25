/**
 * Рапорт Betsy (`.docx`, «FISA PRODUS · ELEMENTE DIN BETON ARMAT»): карточка элемента — что за элемент
 * («COD ELEMENT», «Serie», «PROIECT NR», «TURNAT LA») и таблица операций с датой, ответственным и подписью.
 *
 * Betsy собирает страницу из рамок (`w:framePr`): каждая надпись — абзац в рамке со своим местом на странице
 * (`w:x`, `w:y` в twips), у ячейки таблицы — рамка с линиями и рамка с текстом поверх. Поэтому поля ищутся
 * по месту: значение — первая рамка справа от подписи в той же строке; ячейки строки 6 — рамки на высоте
 * «a)Rezistenta betonului la decofrare…» под заголовками «Data» и «Semnatura».
 *
 * Запись в строку 6 (`fill`): прочность — вместо точек «………........» перед «N/mm2», дата — в ячейку «Data»,
 * подпись — изображением в ячейку «Semnatura» (по размеру ячейки, по центру). Повторная запись заменяет
 * записанное прежде. Остальной документ не меняется.
 *
 * РИСК: рапорт другого вида (без строки «Rezistenta betonului la decofrare» или без заголовков «Data»
 * и «Semnatura») не узнаётся — ошибка с причиной, файл не меняется.
 */
import JSZip from 'jszip'
import { message, MessageError } from '@/shared/messages'
import { cleanText, deburr } from '@/shared/names'
import { calendarDate } from '../laborator/LaboratorBook'
import { escapeXml, unescapeXml, xmlAttr as attr } from '../xml'

/** Элемент рапорта. */
export interface ReportElement {
  /** «COD ELEMENT»: «PO08-TIP1». */
  code: string
  /** «Serie»: «628». */
  serie: string
  /** «PROIECT NR»: «92/8752». */
  project: string
  /** «TURNAT LA» как в рапорте: «03/11/2026». */
  castText: string
  /** «TURNAT LA» — дата (полночь UTC, как даты Excel) или `null`, если не разобрана. */
  cast: Date | null
}

/** Что сейчас в строке 6. */
export interface ReportLabRow {
  /** Прочность перед «N/mm2» или `null` (точки — не заполнено). */
  value: string | null
  /** Текст ячейки «Data». */
  date: string
  /** В ячейке «Semnatura» есть изображение. */
  signed: boolean
}

/** Подпись для ячейки «Semnatura»: PNG и его размер в пикселях. */
export interface ReportSignature {
  png: Uint8Array
  width: number
  height: number
}

/** Что пишется в строку 6. */
export interface ReportFill {
  /** Прочность: «33.3». */
  value: string
  /** Дата: «03/11/2026». */
  date: string
  signature: ReportSignature | null
}

/** Абзац в рамке. */
interface Frame {
  /** Место абзаца в `document.xml`. */
  start: number
  end: number
  xml: string
  /** Рамка, twips. */
  x: number
  y: number
  w: number
  h: number
  text: string
}

/** Прогон (`w:r`) абзаца. */
interface Run {
  start: number
  end: number
  /** `<w:rPr>…</w:rPr>` или пусто. */
  rPr: string
  text: string
  /** Только свойства и один `<w:t>`: такой прогон можно разрезать. */
  simple: boolean
}

/** Размер подписи в ячейке, twips. */
interface SignatureSize {
  widthTwips: number
  heightTwips: number
}

/** Ячейки строки 6. */
interface LabCells {
  description: Frame
  date: Frame
  signature: Frame
}

/** Части `.docx`. */
const DOCUMENT = 'word/document.xml'
const RELS = 'word/_rels/document.xml.rels'
const TYPES = '[Content_Types].xml'
/** Изображение подписи в рапорте: одно на рапорт, повторная запись его заменяет. */
const SIGNATURE_PART = 'media/somasync-signature.png'
/** Имя рисунка подписи в документе. */
const SIGNATURE_NAME = 'Semnatura laborant'

const NS = {
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
}

/** EMU в одном twip. */
const EMU_PER_TWIP = 635
/** Поля подписи внутри ячейки, twips. */
const SIGNATURE_PAD = 60
/** Рамки одной строки и одной колонки — с этой точностью по месту, twips. */
const ROW_TOLERANCE = 60
const COLUMN_TOLERANCE = 20

/** Подписи полей рапорта (без регистра, диакритики и двоеточия). */
const LABELS = {
  code: /^cod element$/,
  serie: /^serie$/,
  project: /^proiect nr\.?$/,
  cast: /^turnat la$/,
} as const

/** Текст для сравнения: без диакритики и регистра, пробелы схлопнуты. */
const norm = (text: string) => deburr(cleanText(text)).toLowerCase()

/** Подпись поля: текст рамки без двоеточия на конце. */
const labelOf = (text: string) => norm(text).replace(/\s*:$/, '')

/**
 * Место прочности в описании строки 6: «decofrare», затем точки «………........» (не заполнено) или записанная
 * прочность, затем «N/mm2».
 */
const VALUE_PLACE = /(decofr[aă]re\s*)([.…]+|\d+(?:[.,]\d+)?)(\s*N\/mm)/i

/** Абзацы документа (вложенных абзацев у Betsy нет). */
const PARAGRAPH = /<w:p\b[^>]*?(?:\/>|>[\s\S]*?<\/w:p>)/g
/** Прогоны абзаца (`<w:rPr>` и `<w:rStyle>` сюда не попадают: после `w:r` — буква). */
const RUN = /<w:r\b[^>]*?(?:\/>|>[\s\S]*?<\/w:r>)/g

/** Свойства абзаца и свойства прогона (или знака абзаца). */
const PPR = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/
const RPR = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>|<w:rPr\b[^>]*\/>/

/** Свойства абзаца: `<w:pPr>…</w:pPr>` или пусто. */
const pPrOf = (xml: string) => PPR.exec(xml)?.[0] ?? ''

/** Текст прогона или абзаца: `<w:t>`, перенос строки — «\n», табуляция — «\t» (свойства абзаца не в счёт). */
function textOf(xml: string): string {
  let out = ''
  for (const m of xml.replace(PPR, '').matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:br\b[^>]*\/>|<w:cr\b[^>]*\/>|<w:tab\b[^>]*\/>/g)) {
    if (m[1] !== undefined) out += unescapeXml(m[1])
    else out += m[0].startsWith('<w:tab') ? '\t' : '\n'
  }
  return out
}

/** Прогоны абзаца с местом в нём. */
function runsOf(paragraph: string): Run[] {
  return [...paragraph.matchAll(RUN)].map((m) => {
    const xml = m[0]
    const rPr = RPR.exec(xml)?.[0] ?? ''
    const inner = xml.replace(/^<w:r\b[^>]*>/, '').replace(/<\/w:r>$/, '').replace(rPr, '')
    return { start: m.index, end: m.index + xml.length, rPr, text: textOf(xml), simple: /^<w:t\b[^>]*>[^<]*<\/w:t>$/.test(inner) || inner === '' }
  })
}

/** Прогон с текстом. */
const runXml = (rPr: string, text: string) => `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`

/**
 * Вставляет `element` в свойства абзаца перед первым из `followers` (порядок элементов `w:pPr` задан схемой),
 * прежний такой элемент убирается. Свойства знака абзаца (`w:rPr`) не трогаются.
 */
function setPPr(pPr: string, name: string, element: string, followers: readonly string[]): string {
  const open = /^<w:pPr\b[^>]*>/.exec(pPr)?.[0] ?? '<w:pPr>'
  let inner = pPr ? pPr.slice(open.length, -'</w:pPr>'.length) : ''
  const rPr = RPR.exec(inner)
  const tail = rPr ? inner.slice(rPr.index) : ''
  inner = (rPr ? inner.slice(0, rPr.index) : inner).replace(new RegExp(`<w:${name}\\b[^>]*?(?:/>|>[\\s\\S]*?</w:${name}>)`, 'g'), '')
  const next = followers.map((f) => new RegExp(`<w:${f}\\b`).exec(inner)?.index ?? -1).filter((i) => i >= 0)
  const at = next.length ? Math.min(...next) : inner.length
  return `${open}${inner.slice(0, at)}${element}${inner.slice(at)}${tail}</w:pPr>`
}

/** Элементы `w:pPr` после `w:spacing` и после `w:jc`. */
const AFTER_JC = ['textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'sectPr', 'pPrChange']
const AFTER_SPACING = ['ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', ...AFTER_JC]

/** Дата «03/11/2026» (или «03.11.2026») в полночь UTC; `null` — не дата. */
export function parseReportDate(text: string): Date | null {
  const m = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*$/.exec(text)
  return m ? calendarDate(m[1]!, m[2]!, m[3]!) : null
}

/** Размер PNG из заголовка (`IHDR`) или `null`, если это не PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  return width && height ? { width, height } : null
}

/** Похоже ли имя на рапорт: `.docx`, не замок Word (`~$…`) и не скрытый файл. */
export const isReportName = (name: string): boolean => /\.docx$/i.test(name) && !name.startsWith('~$') && !name.startsWith('.')

/** Последний из рапортов папки (`isReportName`): самый новый по времени изменения, при равном — по имени. */
export function latestReport(reports: ReadonlyArray<{ name: string; mtimeMs: number }>): string | null {
  return [...reports].sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))[0]?.name ?? null
}

/** Рапорт Betsy. */
export class BetsyReport {
  readonly element: ReportElement
  readonly lab: ReportLabRow
  private readonly zip: JSZip
  private xml: string

  private constructor(zip: JSZip, xml: string) {
    this.zip = zip
    this.xml = xml
    const frames = BetsyReport.frames(xml)
    this.element = BetsyReport.readElement(frames)
    this.lab = BetsyReport.readLab(BetsyReport.labCells(frames))
  }

  /**
   * Читает рапорт.
   * @throws {MessageError} Не `.docx` или не рапорт Betsy (нет строки 6 или колонок «Data», «Semnatura»).
   */
  static async open(bytes: Uint8Array): Promise<BetsyReport> {
    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(bytes)
    } catch {
      throw new MessageError(message('betsy.notDocx'))
    }
    const xml = await zip.file(DOCUMENT)?.async('string')
    if (!xml) throw new MessageError(message('betsy.notDocx'))
    return new BetsyReport(zip, xml)
  }

  /** Рамки документа по порядку. */
  private static frames(xml: string): Frame[] {
    const frames: Frame[] = []
    for (const m of xml.matchAll(PARAGRAPH)) {
      const frame = /<w:framePr\b[^>]*>/.exec(pPrOf(m[0]))?.[0]
      if (!frame) continue
      const num = (name: string) => Number(attr(frame, `w:${name}`) ?? NaN)
      frames.push({ start: m.index, end: m.index + m[0].length, xml: m[0], x: num('x'), y: num('y'), w: num('w'), h: num('h'), text: textOf(m[0]).trim() })
    }
    return frames
  }

  /** Поля элемента: значение — ближайшая рамка с текстом справа от подписи в той же строке (до следующей подписи). */
  private static readElement(frames: readonly Frame[]): ReportElement {
    const isLabel = (f: Frame) => f.text.endsWith(':')
    const value = (pattern: RegExp): string => {
      const label = frames.find((f) => isLabel(f) && pattern.test(labelOf(f.text)))
      if (!label) return ''
      const line = frames.filter((f) => f.text && f !== label && Math.abs(f.y - label.y) <= ROW_TOLERANCE && f.x > label.x).sort((a, b) => a.x - b.x)
      const first = line[0]
      return first && !isLabel(first) ? first.text.replace(/\s+/g, ' ') : ''
    }
    const castText = value(LABELS.cast)
    return { code: value(LABELS.code), serie: value(LABELS.serie), project: value(LABELS.project), castText, cast: parseReportDate(castText) }
  }

  /**
   * Ячейки строки 6: описание «a)Rezistenta betonului la decofrare…», под заголовками «Data» и «Semnatura» —
   * рамки на той же высоте (рамка с текстом, а не рамка с линиями: ближе по месту к заголовку).
   * @throws {MessageError} Строки или колонок нет.
   */
  private static labCells(frames: readonly Frame[]): LabCells {
    const description = frames.find((f) => /rezistenta betonului la decofrare/.test(norm(f.text)))
    if (!description) throw new MessageError(message('betsy.noLabRow'))
    const header = (name: string) =>
      frames.filter((f) => norm(f.text) === name && f.y < description.y).sort((a, b) => b.y - a.y)[0]
    const cell = (column: Frame | undefined) => {
      if (!column) return undefined
      return frames
        .filter((f) => Math.abs(f.x - column.x) <= COLUMN_TOLERANCE && Math.abs(f.y - description.y) <= COLUMN_TOLERANCE)
        .sort((a, b) => Math.abs(a.x - column.x) - Math.abs(b.x - column.x))[0]
    }
    const date = cell(header('data'))
    const signature = cell(header('semnatura'))
    if (!date || !signature) throw new MessageError(message('betsy.layout'))
    return { description, date, signature }
  }

  /** Что сейчас в строке 6. */
  private static readLab(cells: LabCells): ReportLabRow {
    const m = VALUE_PLACE.exec(cells.description.text)
    const value = m && /\d/.test(m[2]!) ? m[2]! : null
    return { value, date: cells.date.text, signed: /<w:drawing\b/.test(cells.signature.xml) }
  }

  /** Записывает прочность, дату и подпись в строку 6. */
  async fill(fill: ReportFill): Promise<void> {
    const cells = BetsyReport.labCells(BetsyReport.frames(this.xml))
    const edits: Array<[Frame, string]> = [
      [cells.description, BetsyReport.withValue(cells.description.xml, fill.value)],
      [cells.date, BetsyReport.withText(cells.date.xml, fill.date)],
    ]
    // без подписи прежний рисунок в ячейке остаётся
    if (fill.signature) {
      const size = BetsyReport.fit(fill.signature, cells.signature)
      edits.push([cells.signature, BetsyReport.withDrawing(cells.signature, await this.addSignature(fill.signature, size), size.heightTwips)])
    }
    // с конца документа: места абзацев выше не сдвигаются
    for (const [frame, xml] of edits.sort((a, b) => b[0].start - a[0].start)) this.xml = this.xml.slice(0, frame.start) + xml + this.xml.slice(frame.end)
    this.xml = BetsyReport.withNamespaces(this.xml)
    this.zip.file(DOCUMENT, this.xml)
  }

  /** Рапорт в байтах. */
  async toBytes(): Promise<Uint8Array> {
    return this.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  }

  /**
   * Прочность вместо точек перед «N/mm2» (или вместо прежде записанной) — отдельным прогоном с тем же оформлением.
   * @throws {MessageError} Места для прочности нет.
   */
  private static withValue(paragraph: string, value: string): string {
    const runs = runsOf(paragraph)
    const full = runs.map((r) => r.text).join('')
    const m = VALUE_PLACE.exec(full)
    if (!m) throw new MessageError(message('betsy.noValuePlace'))
    const from = m.index + m[1]!.length
    const to = from + m[2]!.length
    // пробелы вокруг прочности — обычным текстом: повторная запись заменит только саму прочность
    const lead = /\s$/.test(m[1]!) ? '' : ' '
    const trail = /^\s/.test(m[3]!) ? '' : ' '
    // прогоны, в которые попадает заменяемое
    let offset = 0
    const spans = runs.map((r) => {
      const span = { run: r, from: offset, to: offset + r.text.length }
      offset = span.to
      return span
    })
    const touched = spans.filter((s) => s.to > from && s.from < to)
    if (!touched.length || touched.some((s) => !s.run.simple)) throw new MessageError(message('betsy.noValuePlace'))
    const first = touched[0]!
    const last = touched.at(-1)!
    const before = first.run.text.slice(0, from - first.from) + lead
    const after = trail + last.run.text.slice(to - last.from)
    const xml = [before && runXml(first.run.rPr, before), runXml(first.run.rPr, value), after && runXml(last.run.rPr, after)].filter(Boolean).join('')
    return paragraph.slice(0, first.run.start) + xml + paragraph.slice(last.run.end)
  }

  /** Текст ячейки целиком заменяется: оформление — первого прогона, без прогонов — знака абзаца. */
  private static withText(paragraph: string, text: string): string {
    const runs = runsOf(paragraph)
    const rPr = runs[0]?.rPr ?? (RPR.exec(pPrOf(paragraph))?.[0] ?? '')
    const bare = runs.length ? paragraph.slice(0, runs[0]!.start) + paragraph.slice(runs.at(-1)!.end) : paragraph
    return bare.replace(/<\/w:p>$/, `${runXml(rPr, text)}</w:p>`)
  }

  /** Подпись в ячейке: прежний рисунок убирается, новый (`heightTwips` высотой) — по центру ячейки. */
  private static withDrawing(frame: Frame, drawing: string, heightTwips: number): string {
    const runs = runsOf(frame.xml).filter((r) => /<w:drawing\b/.test(frame.xml.slice(r.start, r.end)))
    let xml = frame.xml
    for (const r of [...runs].reverse()) xml = xml.slice(0, r.start) + xml.slice(r.end)
    const before = Math.max(0, Math.floor((frame.h - heightTwips) / 2) - SIGNATURE_PAD / 2)
    const pPr = pPrOf(xml)
    const fixed = setPPr(setPPr(pPr, 'spacing', `<w:spacing w:before="${before}" w:after="0" w:line="240" w:lineRule="auto"/>`, AFTER_SPACING), 'jc', '<w:jc w:val="center"/>', AFTER_JC)
    xml = pPr ? xml.replace(pPr, fixed) : xml.replace(/^(<w:p\b[^>]*>)/, `$1${fixed}`)
    return xml.replace(/<\/w:p>$/, `${drawing}</w:p>`)
  }

  /** Размер подписи в ячейке, twips: вписана с полями, пропорции сохранены. */
  private static fit(signature: ReportSignature, frame: Frame): SignatureSize {
    const maxW = Math.max(1, frame.w - 2 * SIGNATURE_PAD)
    const maxH = Math.max(1, frame.h - 2 * SIGNATURE_PAD)
    const scale = Math.min(maxW / signature.width, maxH / signature.height)
    return { widthTwips: Math.round(signature.width * scale), heightTwips: Math.round(signature.height * scale) }
  }

  /** Кладёт изображение подписи в рапорт (связь, тип PNG) и строит прогон с рисунком. */
  private async addSignature(signature: ReportSignature, { widthTwips, heightTwips }: SignatureSize): Promise<string> {
    this.zip.file(`word/${SIGNATURE_PART}`, signature.png)
    let rels = (await this.zip.file(RELS)?.async('string')) ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
    let id = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((tag) => attr(tag, 'Target') === SIGNATURE_PART)
    let rId = id ? attr(id, 'Id')! : ''
    if (!rId) {
      const taken = new Set([...rels.matchAll(/\bId="([^"]*)"/g)].map((m) => m[1]))
      let n = 1
      while (taken.has(`rIdSomasync${n}`)) n++
      rId = `rIdSomasync${n}`
      id = `<Relationship Id="${rId}" Type="${NS.image}" Target="${SIGNATURE_PART}"/>`
      rels = rels.replace(/<\/Relationships>\s*$/, `${id}</Relationships>`)
      this.zip.file(RELS, rels)
    }
    const types = (await this.zip.file(TYPES)?.async('string')) ?? ''
    if (types && !/<Default\b[^>]*Extension="png"/i.test(types)) this.zip.file(TYPES, types.replace(/(<Types\b[^>]*>)/, '$1<Default Extension="png" ContentType="image/png"/>'))
    const [cx, cy] = [widthTwips * EMU_PER_TWIP, heightTwips * EMU_PER_TWIP]
    const docPr = Math.max(0, ...[...this.xml.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]))) + 1
    return (
      `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docPr}" name="${SIGNATURE_NAME}"/>` +
      `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${NS.a}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic xmlns:a="${NS.a}"><a:graphicData uri="${NS.pic}"><pic:pic xmlns:pic="${NS.pic}">` +
      `<pic:nvPicPr><pic:cNvPr id="0" name="${SIGNATURE_NAME}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
    )
  }

  /** Пространства имён рисунка (`wp`, `r`) — в корне документа, если их там нет. */
  private static withNamespaces(xml: string): string {
    return xml.replace(/<w:document\b[^>]*>/, (tag) => {
      let out = tag
      for (const prefix of ['wp', 'r'] as const) if (!out.includes(`xmlns:${prefix}=`)) out = out.replace(/>$/, ` xmlns:${prefix}="${NS[prefix]}">`)
      return out
    })
  }
}
