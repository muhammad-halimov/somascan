/**
 * Поля бирки из текста, прочитанного на устройстве (ML Kit, Apple Vision), — правилами, без модели.
 *
 * 1. В каждой строке ищутся подписи полей (`fieldRules`): «Charge/Adag/Wytop:» — плавка, «Weight (kg)» — вес.
 * 2. Значение подписи — в той же строке после неё («Heat No: 251216»), иначе справа в той же строке таблицы,
 *    иначе сразу под ней. Каждое чтение проверяет, похож ли текст на значение поля (плавка — код с цифрами,
 *    вес — число с единицами), и уверенно похожие кандидаты сильнее остальных.
 * 3. Одна строка значения достаётся одному полю: сначала самым сильным кандидатам.
 * 4. Производитель сверяется со списком известных поставщиков; изделие, марка стали и размер с «Ø»
 *    находятся и без подписи; коды (QR, DataMatrix) исправляют похожие знаки в номерах.
 *
 * Результат — в том же виде, что ответ модели: поля и оценка фото.
 */
import type { PhotoAssessment } from '../label/LabelParser'
import type { LabelFieldDefinition, LabelKey, LabelRecord, LabelValue } from '../label/labelFields'
import { findLabel, sourceEnd, foldWithMap, type FoldedText } from './foldText'
import { buildFieldRules, type FieldRule } from './fieldRules'
import type { OcrCode, OcrPage } from './ocrTypes'
import { boxHeight, isBelow, isRightOf, layoutPage, sameRow, typicalLineHeight, type PageLine } from './pageLayout'
import { companyDomains, companyFromDomain, supplierByDomain } from './domainProducer'
import { findSupplier } from './supplierMatch'
import { findGrade, findMarkedSize, findProduct } from './valueReaders'

/** Что разбирать. */
export interface ExtractionInput {
  /** Текст фото в одном повороте. */
  page: OcrPage
  /** Коды на фото (QR, DataMatrix, штрихкоды). */
  codes: readonly OcrCode[]
  /** Поля, которые нужно заполнить (включённые и читаемые с фото). */
  fields: readonly LabelFieldDefinition[]
  /** Известные поставщики. */
  suppliers: readonly string[]
}

/** Результат разбора одной страницы. */
export interface Extraction {
  /** Поля бирки; ненайденные — `null`. */
  label: LabelRecord
  /** Оценка фото: без текста — «нет бирки», без единой подписи — переснять. */
  photo: PhotoAssessment
  /**
   * Насколько страница похожа на правильно повёрнутую бирку: сколько разных полей подписано, плюс сколько
   * из них нашли значение, плюс 1 за известного поставщика; 0 — текст боком. По нему выбирается поворот фото
   * (у перевёрнутой бирки подписи находятся, а значения — нет: они оказываются слева).
   */
  score: number
  /** Сколько текста прочитано (с поправкой на уверенность): второй признак удачного поворота. */
  textWeight: number
  /**
   * На сколько четвертей оборота пришлось повернуть координаты строк: не 0 — движок прочёл бирку боком
   * или вверх ногами (такой текст он читает хуже — фото стоит перечитать повёрнутым).
   */
  turns: number
}

/** Найденная подпись поля в строке. */
interface LabelHit {
  key: LabelKey
  /** Начало и конец в сложенном тексте строки. */
  start: number
  end: number
}

/** Подписи одного поля подряд в строке («Charge/Adag/Wytop») и текст после них до следующей подписи. */
interface LabelGroup {
  key: LabelKey
  /** Текст после подписи до следующей подписи другого поля. */
  rest: string
}

/** Строка с найденными подписями. */
interface LabelLine {
  line: PageLine
  groups: LabelGroup[]
}

/** Кандидат в значение поля. */
interface Candidate {
  key: LabelKey
  value: LabelValue
  score: number
  /** Строка значения (одна строка — одному полю); `null` — значение в строке подписи. */
  line: number | null
}

/** Насколько сильнее кандидат, похожий на значение поля как две капли воды. */
const STRONG_BONUS = 1.5

/** Сила кандидата по его месту. */
const SCORE = {
  /** После подписи и двоеточия в той же строке. */
  inlineColon: 4,
  /** После подписи в той же строке, без двоеточия. */
  inline: 3.5,
  /** Справа в той же строке таблицы (ближайший). */
  right: 3,
  /** Сразу под подписью (ближайший). */
  below: 2,
  /** Каждый следующий по удалённости кандидат слабее на столько. */
  step: 0.25,
}

/** Подписи в строке: все вхождения всех подписей, из пересекающихся — самые длинные. */
function findHits(folded: FoldedText, rules: readonly FieldRule[]): LabelHit[] {
  const all: LabelHit[] = []
  for (const rule of rules) {
    for (const label of rule.labels) {
      for (const match of findLabel(folded, label)) all.push({ key: rule.key, ...match })
    }
  }
  all.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
  const kept: LabelHit[] = []
  for (const hit of all) {
    if (!kept.some((other) => hit.start < other.end && other.start < hit.end)) kept.push(hit)
  }
  return kept.sort((a, b) => a.start - b.start)
}

/** Подписи строки, сгруппированные по полям, с текстом после каждой группы. */
function groupHits(line: PageLine, hits: readonly LabelHit[]): LabelGroup[] {
  const groups: Array<{ key: LabelKey; start: number; end: number }> = []
  for (const hit of hits) {
    const last = groups.at(-1)
    if (last && last.key === hit.key) last.end = hit.end
    else groups.push({ key: hit.key, start: hit.start, end: hit.end })
  }
  return groups.map((group, index) => {
    const from = sourceEnd(line.folded, line.text, group.end)
    const next = groups[index + 1]
    const to = next ? line.folded.origin[next.start]! : line.text.length
    return { key: group.key, rest: line.text.slice(from, to) }
  })
}

/**
 * Значение в строке подписи: после двоеточия, иначе после подписи — если это не продолжение подписи
 * на других языках («Quality/Minőség/Jakość» — OCR не всё узнал, «/Jakost» — не значение).
 * Двоеточие подписи — до первой цифры: в «Time01:38:42» (OCR съел двоеточие) двоеточия — часть значения.
 */
function inlineText(rest: string): { text: string; colon: boolean } {
  const colon = /^[^\d:：]*[:：]/u.exec(rest)
  if (colon) return { text: rest.slice(colon[0].length), colon: true }
  const text = rest.replace(/^(?:\s*[/|]\s*\p{L}[\p{L}.]*(?=[\s/|(]|$))+/u, '')
  // Двоеточие потерялось, а перед значением с цифрами — ещё слова подписи («…identyfikator 8/7»).
  return { text: /\d/.test(text) ? text.replace(/^(?:\s*\p{L}{5,}(?=\s))+/u, '') : text, colon: false }
}

/** Поправка на уверенность OCR: неуверенно прочитанная строка — слабее. */
const confidenceFactor = (line: PageLine) => 0.8 + 0.2 * (line.confidence ?? 1)

/**
 * Разбирает страницу. Движок мог прочесть повёрнутую бирку и отдать строки боком или вверх ногами — причём
 * в координатах исходного или повёрнутого фото, смотря по движку и платформе. Поэтому разбор пробует все четыре
 * поворота координат и берёт тот, где подписи нашли свои значения (`Extraction.score`): это миллисекунды,
 * а от договорённостей движка о координатах результат не зависит.
 * @returns Поля, оценка фото и признаки удачного поворота.
 */
export function extractLabel(input: ExtractionInput): Extraction {
  const rules = buildFieldRules(input.fields)
  return bestExtraction([0, 1, 2, 3].map((turns) => extractTurned(input, rules, turns)))!
}

/** Разбор страницы, координаты строк которой повёрнуты на `turns` четвертей оборота. */
function extractTurned({ page, codes, fields, suppliers }: ExtractionInput, rules: readonly FieldRule[], turns: number): Extraction {
  const ruleOf = new Map(rules.map((rule) => [rule.key, rule]))
  const lines = layoutPage(page, turns)
  const lineHeight = typicalLineHeight(lines)
  // Коды — тоже текст: в них бывает «HEAT: 251216». В соседстве они не участвуют (рамки нет).
  const codeLines: PageLine[] = codes.flatMap((code) => code.text.split(/[\r\n;|]+/))
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({ index: lines.length + index, text, folded: foldWithMap(text), confidence: null, box: null }))

  const labelLines: LabelLine[] = []
  for (const line of [...lines, ...codeLines]) {
    const hits = findHits(line.folded, rules)
    if (hits.length > 0) labelLines.push({ line, groups: groupHits(line, hits) })
  }
  const isLabelLine = new Set(labelLines.map(({ line }) => line.index))
  const labelBoxes = labelLines.flatMap(({ line }) => (line.box ? [line.box] : []))

  const candidates: Candidate[] = []
  const propose = (rule: FieldRule, text: string, label: PageLine, baseScore: number, valueLine: PageLine | null) => {
    const value = rule.read(text, { label: label.text })
    if (value === null || value === '') return
    const strong = rule.strong?.(value) ? STRONG_BONUS : 0
    const source = valueLine ?? label
    candidates.push({ key: rule.key, value, score: (baseScore + strong) * confidenceFactor(source), line: valueLine?.index ?? null })
  }

  for (const { line, groups } of labelLines) {
    groups.forEach((group, groupIndex) => {
      const rule = ruleOf.get(group.key)!
      const inline = inlineText(group.rest)
      const before = candidates.length
      if (inline.text.trim()) propose(rule, inline.text, line, inline.colon ? SCORE.inlineColon : SCORE.inline, null)
      if (candidates.length > before || !line.box) return
      const box = line.box
      // Справа в той же строке — значение последней подписи строки; другая подпись между ними — граница.
      if (groupIndex === groups.length - 1) {
        let right = lines
          .filter((other) => other.box && !isLabelLine.has(other.index) && isRightOf(box, other.box))
          .filter((other) => !labelBoxes.some((labelBox) => labelBox !== box && sameRow(box, labelBox)
            && labelBox.left >= box.right - lineHeight * 0.2 && labelBox.left < (other.box!.left + other.box!.right) / 2))
          .sort((a, b) => a.box!.left - b.box!.left)
        // Несколько значений (стандарты) — один столбец: строки, начинающиеся там же, где ближайшая.
        if (rule.multi && right[0]) {
          const column = right[0].box!.left
          right = right.filter((other) => Math.abs(other.box!.left - column) <= lineHeight * 2)
        }
        right.forEach((other, rank) => propose(rule, other.text, line, SCORE.right - SCORE.step * rank, other))
      }
      // Под подписью — только если подпись в строке одна (иначе непонятно, под какой из них значение).
      if (groups.length === 1 && !rule.multi) {
        const below = lines
          .filter((other) => other.box && !isLabelLine.has(other.index) && isBelow(box, other.box, lineHeight))
          .sort((a, b) => a.box!.top - b.box!.top)
          .slice(0, 2)
        below.forEach((other, rank) => propose(rule, other.text, line, SCORE.below - SCORE.step * rank, other))
      }
    })
  }

  // Самые сильные кандидаты — первыми; строка значения достаётся одному полю (поля со многими значениями
  // собирают все свои строки).
  const values = new Map<LabelKey, Array<{ value: LabelValue; line: number | null }>>()
  const usedLines = new Set<number>()
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    const multi = ruleOf.get(candidate.key)?.multi ?? false
    const taken = values.get(candidate.key)
    if (taken && !multi) continue
    if (candidate.line !== null && usedLines.has(candidate.line)) continue
    if (taken?.some((item) => item.value === candidate.value)) continue
    values.set(candidate.key, [...(taken ?? []), { value: candidate.value, line: candidate.line }])
    if (candidate.line !== null) usedLines.add(candidate.line)
  }

  const lineTop = (index: number | null) => (index === null ? -1 : lines[index]?.box?.top ?? -1)
  const found = (key: LabelKey): LabelValue => {
    const items = values.get(key)
    if (!items) return null
    if (!ruleOf.get(key)?.multi) return items[0]!.value
    return [...items].sort((a, b) => lineTop(a.line) - lineTop(b.line)).map((item) => String(item.value)).join('; ')
  }
  const freeLines = lines.filter((line) => !usedLines.has(line.index) && !isLabelLine.has(line.index))
  const firstOf = (find: (text: string) => string | null) => {
    for (const line of freeLines) {
      const value = find(line.text)
      if (value) return value
    }
    return null
  }

  // Производитель: известный поставщик — сначала в строке у подписи, потом где угодно на бирке,
  // потом по почте или сайту завода; нет и его — своё название из домена (когда подписи с названием нет).
  const producerItem = values.get('producer')?.[0]
  const producerLabels = labelLines.filter(({ groups }) => groups.some((group) => group.key === 'producer')).map(({ line }) => line.text)
  const topDown = [...lines].sort((a, b) => a.box!.top - b.box!.top).map((line) => line.text)
  const supplierTexts = [
    ...(producerItem?.line != null ? [lines[producerItem.line]!.text] : []),
    ...producerLabels,
    ...topDown,
  ]
  const domains = companyDomains([...topDown, ...codes.map((code) => code.text)])
  const supplier = suppliers.length > 0 ? findSupplier(supplierTexts, suppliers) ?? supplierByDomain(domains, suppliers) : null

  const label: LabelRecord = {}
  for (const field of fields) {
    let value = found(field.key)
    if (field.key === 'producer' && supplier) value = supplier
    if (field.key === 'producer' && value === null && domains[0]) value = companyFromDomain(domains[0])
    if (value === null && field.key === 'product') value = firstOf(findProduct)
    if (value === null && field.key === 'grade') value = firstOf(findGrade)
    if (value === null && field.key === 'size') value = firstOf(findMarkedSize)
    label[field.key] = typeof value === 'string' ? correctByCodes(value, codes) : value
  }

  const labelled = new Set(labelLines.filter(({ line }) => line.box).flatMap(({ groups }) => groups.map((group) => group.key)))
  // Текст боком (бирку сняли повёрнутой, а движок прочёл строки сверху вниз): подписи найдены, но «справа»
  // и «под» не работают — такая страница не годится, её заменит чтение повёрнутого фото.
  const filled = [...values.keys()].filter((key) => labelled.has(key)).length
  const score = isUpright(lines) ? labelled.size + filled + (supplier ? 1 : 0) : 0
  const textWeight = lines.reduce((sum, line) => sum + line.text.length * (line.confidence ?? 1), 0)
  const photo: PhotoAssessment = lines.length === 0
    ? { ok: false, issues: ['noTag'] }
    : { ok: score > 0, issues: [] }
  return { label, photo, score, textWeight, turns }
}

/**
 * Строки идут слева направо: у большей части текста (по числу знаков, строки от четырёх знаков) рамка шире,
 * чем выше. Если текст прочитан боком, рамки строк — высокие и узкие.
 */
function isUpright(lines: readonly PageLine[]): boolean {
  let across = 0
  let along = 0
  for (const line of lines) {
    const length = line.text.replace(/\s/g, '').length
    if (!line.box || length < 4) continue
    if (line.box.right - line.box.left >= boxHeight(line.box)) across += length
    else along += length
  }
  return across >= along
}

/** Знаки, которые OCR путает, — к одному виду для сравнения с кодом. */
const lookalikeKey = (text: string) => text.toUpperCase().replace(/[\s-]/g, '')
  .replace(/[OQD]/g, '0').replace(/[IL|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2').replace(/G/g, '6')

/**
 * Номер, который есть и в коде (QR, DataMatrix): код читается без ошибок, поэтому если значение
 * совпадает с куском кода с точностью до похожих знаков («25R0O581» и «25R00581»), берём написание из кода.
 */
function correctByCodes(value: string, codes: readonly OcrCode[]): string {
  if (codes.length === 0 || value.length < 4 || !/\d/.test(value)) return value
  const key = lookalikeKey(value)
  for (const code of codes) {
    for (const token of code.text.split(/[^\p{L}\p{N}]+/u)) {
      if (token.length >= 4 && token !== value && lookalikeKey(token) === key) return token
    }
  }
  return value
}

/** Лучшая из страниц разных поворотов: больше подписанных полей, при равенстве — больше текста. */
export function bestExtraction(extractions: readonly Extraction[]): Extraction | null {
  let best: Extraction | null = null
  for (const extraction of extractions) {
    if (!best || extraction.score > best.score || (extraction.score === best.score && extraction.textWeight > best.textWeight)) best = extraction
  }
  return best
}
