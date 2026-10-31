/**
 * Значения полей из текста, прочитанного OCR: номер плавки, размер, вес в килограммах, дата, время.
 * Каждое чтение либо возвращает значение в том виде, в каком его ждёт приложение (как ответ модели:
 * `"12 mm"`, `2650`, `"2025-02-12"`), либо `null`, если текст на значение поля не похож.
 */
import type { LabelValue } from '../label/labelFields'

/** Что известно о месте значения: подпись, к которой оно относится (в ней бывают единицы — «(kg)», «(mm)», «t»). */
export interface ReadContext {
  /** Текст строки подписи; пустой — значение найдено без подписи. */
  label: string
}

/** Читает значение поля из текста или возвращает `null`. */
export type ValueReader = (text: string, context: ReadContext) => LabelValue

/** Кириллические буквы, неотличимые от латинских: в кодах (B500C, 25R00581) это латиница. */
const CYRILLIC_LOOKALIKES: Readonly<Record<string, string>> = {
  А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X', У: 'Y', І: 'I',
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i',
}

/** Кириллические двойники латинских букв — латиницей. */
export const latinize = (text: string) => text.replace(/[АВСЕНКМОРТХУІаеорсхуі]/gu, (char) => CYRILLIC_LOOKALIKES[char] ?? char)

/**
 * Убирает вокруг значения разделители и пометку номера: «: 25R00581», «No. 581», «Nr 12», «№ 4657 / 30» —
 * без «No» и знаков (и полноширинных «：», «、», которые иногда выдаёт OCR). «№» латинский OCR читает как «Ne»,
 * «Ng», «N» — это тоже пометка. Пробелы внутри сводятся к одному.
 */
export function cleanValue(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;.,\-–—/\\|#№*()[\]：、，]+/u, '')
    .replace(/^(?:no|nr|ne|ng|n°|nº|num|number|n)(?=[\s.:#№]|$)[\s.:#№]*/iu, '')
    .replace(/[\s:;,\-–—/\\|*(：、，]+$/u, '')
    .trim()
}

/** Похожие на цифры буквы рядом с цифрами — цифры: «25R0O581» → «25R00581», «l2» → «12». */
export function fixDigitLookalikes(token: string): string {
  const chars = [...token]
  return chars.map((char, index) => {
    const nearDigit = /\d/.test(chars[index - 1] ?? '') || /\d/.test(chars[index + 1] ?? '')
    if (!nearDigit) return char
    if (char === 'O' || char === 'o') return '0'
    if (char === 'I' || char === 'l' || char === '|') return '1'
    return char
  }).join('')
}

/** Сколько цифр в тексте. */
const digitCount = (text: string) => text.replace(/\D/g, '').length

/**
 * Код как напечатан (без «No», лишних знаков и пробелов), кириллические двойники — латиницей.
 * Двоеточие между буквами — шум OCR («ORDER NO: CM 6389» читается как «C:M6389»).
 */
export const readCode: ValueReader = (text) => {
  // Точка после последней цифры — конец фразы на бирке, а не часть кода («Shift No: 3.»).
  const value = latinize(cleanValue(text)).replace(/(?<=\d)\.$/, '').replace(/(?<=\p{L}):(?=\p{L})/gu, '')
  return /[\p{L}\p{N}]/u.test(value) && value.length <= 40 ? value : null
}

/** Стандарт: код, в котором есть буквы («ST009-2011», «EN ISO 15630-1»); голое число («260619») — не стандарт. */
export const readStandard: ValueReader = (text, context) => {
  const value = readCode(text, context)
  return typeof value === 'string' && /\p{L}/u.test(value) ? value : null
}

/** Код, в котором есть цифры (номер партии, серийный номер, номер договора). */
export const readNumberedCode: ValueReader = (text, context) => {
  const value = readCode(text, context)
  return typeof value === 'string' && /\d/.test(value) ? fixDigitLookalikes(value) : null
}

/** Название (производитель, изделие, заказчик): хотя бы две буквы. */
export const readText: ValueReader = (text) => {
  const value = cleanValue(text)
  return (value.match(/\p{L}/gu)?.length ?? 0) >= 2 && value.length <= 80 ? value : null
}

/** Шаблон номера плавки: одно «слово» из букв, цифр и дефисов, в нём не меньше трёх цифр. */
const HEAT = /^[A-Z0-9][A-Z0-9-]{3,15}$/

/** Номер плавки с точкой внутри (Acciaierie di Sicilia: «2688.26»). */
const DOTTED_HEAT = /^\d{3,}\.\d{2,}$/

/**
 * Номер плавки: «251216», «25R00581», «2604-3-065-20», «2688.26». Пробел внутри короткого номера убирается
 * («25R 00581»), пробелы вокруг дефисов — тоже («2604 – 3 – 065 – 20»); буквы-двойники рядом с цифрами
 * становятся цифрами.
 */
export const readHeat: ValueReader = (text) => {
  const value = latinize(cleanValue(text)).toUpperCase().replace(/\s*[-–—]\s*/g, '-')
  const words = value.split(/[\s/]+/).map((word) => word.replace(/[.,;:]+$/, ''))
  const compact = value.replace(/\s+/g, '')
  const options = words.length <= 2 && compact.length <= 10 ? [compact, ...words] : words
  for (const option of options) {
    const heat = fixDigitLookalikes(option)
    if ((HEAT.test(heat) || DOTTED_HEAT.test(heat)) && digitCount(heat) >= 3) return heat
  }
  return null
}

/** Похож ли номер на плавку уверенно: 5–12 знаков, из них хотя бы четыре цифры. */
export const isStrongHeat = (value: LabelValue) =>
  typeof value === 'string' && value.length >= 5 && value.length <= 12 && digitCount(value) >= 4 && !value.includes('-')

/**
 * Плавка без подписи: строка целиком — уверенный номер плавки («2620040»), без других слов. Дата, время,
 * короткие числа («3557»), длинные коды (серийный номер) и слитые с маркой стали «13 Ø12 B500C» не подходят.
 */
export function findOrphanHeat(text: string): string | null {
  const value = cleanValue(text)
  if (/\s/.test(value) || /[/:.]/.test(value) || GLUED_GRADE.test(latinize(value).toUpperCase())) return null
  const heat = readHeat(value, { label: '' })
  return heat !== null && isStrongHeat(heat) ? String(heat) : null
}

/** Подпись штрихкода Code 39 — номер в звёздочках («*B000713412E*»); OCR часто теряет одну из звёздочек. */
const CODE39_TEXT = /^\*\s*([^*]+?)\s*\*?$|^([^*]+?)\s*\*$/

/**
 * Номер под штрихкодом Code 39 («*B000713412E*» → «B000713412E»): одно слово из букв и цифр (можно с точкой,
 * дефисом, косой чертой), в нём не меньше четырёх цифр. Без звёздочек не берётся — просто число на бирке
 * может быть чем угодно.
 */
export function findCode39Text(text: string): string | null {
  const match = CODE39_TEXT.exec(text.trim())
  if (!match) return null
  const body = fixDigitLookalikes(latinize(match[1] ?? match[2]!).replace(/\s+/g, '').toUpperCase())
  return /^[A-Z0-9][A-Z0-9./-]{4,18}[A-Z0-9]$/.test(body) && digitCount(body) >= 4 ? body : null
}

/**
 * Размер: пометка (Ø, Ф, Φ, D — диаметр, R — гладкий пруток, Q — пометка Çolakoğlu), число от 4 до 60,
 * необязательно «mm».
 */
const SIZE = /^(?:(Ø|⌀|ø|Ф|Φ|diam\.?|D|R|Q)\s*)?(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:mm|мм)?(?=$|[\s,;/x×*])/iu

/** «Ø» перед числом с «mm», прочитанный как ноль: «Ø12MM» → «012MM». */
const ZERO_AS_DIAMETER = /^0(?=\d{1,2}(?:[.,]\d)?\s*(?:mm|мм))/iu

/**
 * Пометка перед числом, прочитанная мусором (1–3 знака без цифр): «№ 20», перечёркнутый царапиной, OCR читает
 * как «Al° 20», «Nº20». Значение — только пометка и число.
 */
const DAMAGED_MARK = /^[^\d\s]{1,3}\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:mm|мм)?$/iu

/**
 * Размер (номинальный диаметр): «12» в строке «(mm)» → «12 mm», «Ø12», «12mm», «012MM» (OCR прочёл «Ø» как ноль),
 * «10,0» → «10 mm», «R20» — как есть, «Al° 20» (пометка номера испорчена) → «20 mm».
 */
export const readSize: ValueReader = (text) => {
  const value = fixDigitLookalikes(cleanValue(text)).replace(ZERO_AS_DIAMETER, 'Ø')
  const match = SIZE.exec(value)
  const raw = match?.[2] ?? DAMAGED_MARK.exec(value)?.[1]
  if (!raw) return null
  const number = raw.replace(/[.,]0+$/, '')
  const size = Number.parseFloat(number.replace(',', '.'))
  if (!(size >= 4 && size <= 60)) return null
  // R (гладкий пруток) и Q — как на бирке; остальные пометки — диаметр в миллиметрах.
  const mark = match?.[1]?.toUpperCase()
  return mark === 'R' || mark === 'Q' ? `${mark}${number}` : `${number} mm`
}

/** Диаметры арматуры и катанки — уверенный размер. */
const COMMON_SIZES = new Set([5.5, 6, 6.5, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32, 36, 40, 50])

/** Похож ли размер на типичный диаметр. */
export const isStrongSize = (value: LabelValue) =>
  typeof value === 'string' && COMMON_SIZES.has(Number.parseFloat(value.replace(/^R/, '').replace(',', '.')))

/** Единица веса в тексте: тонны или килограммы; `null` — не указана. */
function weightUnit(text: string): 't' | 'kg' | null {
  if (/kg|кг/iu.test(text)) return 'kg'
  if (/(?:^|[^\p{L}])(?:t|to|tn|ton|tons|tonne|tonnes|mt|т)(?:[^\p{L}]|$)/iu.test(text)) return 't'
  return null
}

/** Число: сначала с разделителями тысяч («2 650», «2.650», «2,650»), иначе обычное («2650», «2.0»). */
const AMOUNT = /\d{1,3}(?:[ .,'’]\d{3})+(?!\d)|\d+(?:[.,]\d+)?/u

/** Вес бунта/пачки в килограммах — разумные пределы. */
const MIN_WEIGHT_KG = 50
const MAX_WEIGHT_KG = 30_000

/** Без единиц вес меньше этого — тонны («2.65» → 2650 кг): бунт весит тонны, а не килограммы. */
const TONNES_BELOW = 50

/**
 * Вес в килограммах: «2650», «2 650 kg», «1990 Kg», «2.0 Ton Approx» → 2000. Единица — из значения,
 * иначе из подписи («Weight (kg)», «Net weight, t»); без единиц малое число считается тоннами.
 */
export const readWeightKg: ValueReader = (text, context) => {
  const value = fixDigitLookalikes(cleanValue(text))
  const first = AMOUNT.exec(value)
  if (!first) return null
  let raw = first[0]
  let after = value.slice(first.index + raw.length)
  // Диапазон («abt 2-2,5 mt») — верхняя граница, как берёт модель.
  const upper = AMOUNT.exec(after)
  if (upper && /^\s*[-–]\s*$/.test(after.slice(0, upper.index))) {
    raw = upper[0]
    after = after.slice(upper.index + raw.length)
  }
  const unit = weightUnit(after) ?? weightUnit(context.label)
  const plain = (number: string) => Number.parseFloat(number.replace(/[\s'’]/g, '').replace(',', '.'))
  let kg: number
  if (unit === 't') {
    kg = plain(raw) * 1000
  } else {
    kg = /^\d{1,3}(?:[ .,'’]\d{3})+$/.test(raw) ? Number.parseInt(raw.replace(/\D/g, ''), 10) : plain(raw)
    if (unit === null && kg < TONNES_BELOW) kg *= 1000
  }
  if (!Number.isFinite(kg) || kg < MIN_WEIGHT_KG || kg > MAX_WEIGHT_KG) return null
  return Math.round(kg * 1000) / 1000
}

/** Похож ли вес на вес бунта или пачки (100 кг – 5 т). */
export const isStrongWeight = (value: LabelValue) => typeof value === 'number' && value >= 100 && value <= 5000

/** Двузначный год — 20xx. */
const fullYear = (year: string) => (year.length === 2 ? 2000 + Number(year) : Number(year))

/** Дата в ISO, если она существует. */
function isoDate(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Дата в ISO: «2025-02-12», «2025-02 -12» (пробелы от OCR), «22/12/2025», «04.01.26» — день первым,
 * если год не впереди.
 */
export const readDate: ValueReader = (text) => {
  const value = fixDigitLookalikes(text).replace(/\s*([-./])\s*/g, '$1')
  const yearFirst = /(?<!\d)(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/.exec(value)
  if (yearFirst) return isoDate(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]))
  const dayFirst = /(?<!\d)(\d{1,2})[-./](\d{1,2})[-./](\d{4}|\d{2})(?!\d)/.exec(value)
  if (dayFirst) return isoDate(fullYear(dayFirst[3]!), Number(dayFirst[2]), Number(dayFirst[1]))
  return null
}

/** Время в 24-часовом виде: «11:27 AM» → «11:27», «3:05:10 PM» → «15:05:10». */
export const readTime: ValueReader = (text) => {
  const match = /(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?\s*m\.?(?!\p{L}))?/iu.exec(fixDigitLookalikes(text))
  if (!match) return null
  let hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = match[3] === undefined ? null : Number(match[3])
  const half = match[4]?.toLowerCase()
  if (half === 'p' && hours < 12) hours += 12
  if (half === 'a' && hours === 12) hours = 0
  if (hours > 23 || minutes > 59 || (seconds !== null && seconds > 59)) return null
  const pad = (number: number) => String(number).padStart(2, '0')
  return seconds === null ? `${pad(hours)}:${pad(minutes)}` : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/** Количество (прутков в пачке): целое число. */
export const readCount: ValueReader = (text) => {
  const match = /^\d{1,5}(?!\d)/.exec(fixDigitLookalikes(cleanValue(text)))
  return match ? Number(match[0]) : null
}

/** Марка стали: «B500C», «BSt 500 S», «A500C», «S235JR». */
const GRADE = /^(?:[A-Z]{1,4}\s?-?\d{3}[A-Z0-9]{0,4}|[A-Z]{1,4}\s?\d{3}\s?[A-Z]{1,2})$/

/** Основа марки в тексте: буквы и три цифры («B500», «BSt 500», «A 500», «S 275»); буквы класса — после неё. */
const GRADE_BASE = /(?:^|[^A-Z0-9])(BST|B|A|K|S)\s?-?(\d{3})/

/** «B» марки, прочитанный как «3» или «8»: «3500C» → «B500C». */
const DIGIT_AS_B = /^[38](?=(?:400|420|450|500|550|600)[A-D]?$)/

/** Марка арматуры в конце слова, слитая с цифрами перед ней: «13Ø12B500C» → «B500C», «…R8B500C». */
const GLUED_GRADE = /(?:^|\d)((?:B|BST|A|K)[4-6]\d{2}[A-D])$/

/**
 * Класс пластичности, напечатанный словами: «Ductility Class C», «CLASA DUCTILITATE C», «DuctilityClassC»
 * (OCR потерял пробелы; но не марка после слова — «Ductility B500C»), а если `bareClass` — и просто «Class C»
 * (одна буква A–C после «Class», не начало слова).
 */
export function findDuctilityClass(text: string, bareClass = true): string | null {
  const upper = latinize(text).toUpperCase()
  return /(?:DUCTILITY|DUCTILITATE)\s*(?:CLASS|CLASA)?\s*:?\s*([A-C])(?!\d)/.exec(upper)?.[1]
    ?? (bareClass ? /CLASS\s*([A-C])(?![A-Z])/.exec(upper)?.[1] : undefined)
    ?? null
}

/** Размер, длина или вес, а не марка: «014MM», «12M», «780KG». */
const MEASURE = /^\d+(?:[.,]\d+)?\s*(?:MM|CM|M|KG|KGS|T)$/i

/**
 * Марка стали (буквы-двойники рядом с цифрами — цифры: «B5OOC» → «B500C», «3500C» → «B500C»). Класс
 * пластичности, напечатанный отдельно, дописывается к основе: «B 500 Ductility Class C» → «B500C». Длинный текст
 * без марки («C acc to AT», который достался подписи «Class» внутри строки) — не марка; короткий код без неё
 * («St3sp») — как есть, если это не размер или вес («014MM») и не просто числа («40-60»).
 */
export const readGrade: ValueReader = (text, context) => {
  const value = readCode(text, context)
  if (typeof value !== 'string') return null
  const code = fixDigitLookalikes(fixDigitLookalikes(value)).replace(DIGIT_AS_B, 'B')
  const upper = latinize(code).toUpperCase()
  const base = GRADE_BASE.exec(upper)
  if (base) {
    // Буквы класса сразу за цифрами («B500C», «BSt 500 S», «S275JR»), иначе отдельно напечатанный класс
    // пластичности — в значении или где-то в строке подписи («QUALITY: B500 Ductility Class C»).
    const tail = upper.slice(base.index + base[0].length)
    const letters = /^\s?([A-Z]{1,2})(?![A-Z])/.exec(tail)?.[1] ?? findDuctilityClass(upper) ?? findDuctilityClass(context.label) ?? ''
    return `${base[1] === 'BST' ? 'BSt' : base[1]}${base[2]}${letters}`
  }
  return code.length <= 8 && /\d/.test(code) && /\p{L}/u.test(code) && !/\s/.test(code) && !MEASURE.test(code) ? code : null
}

/** Похоже ли значение на марку стали. */
export const isStrongGrade = (value: LabelValue) => typeof value === 'string' && GRADE.test(value.toUpperCase())

/** Конструкционная сталь: «S235JR», «S275J0», «S355J2». */
const STRUCTURAL_GRADE = /^S(?:235|275|355|420|460)(?:JR|J0|J2|K2|N|NL|M|ML)?$/

/**
 * Марка стали где угодно в строке (без подписи): отдельное слово вида «B500C» или «S275JR», или марка арматуры,
 * слитая с цифрами перед ней («13Ø12B500C» — OCR потерял пробелы).
 */
export function findGrade(text: string): string | null {
  const words = latinize(text).toUpperCase().split(/[\s/,;:()]+/)
  for (const word of words) {
    if (/^(?:B|BST|A|K)\d{3}[A-Z]{1,2}$/.test(word) || STRUCTURAL_GRADE.test(word)) return word
  }
  for (const word of words) {
    const glued = GLUED_GRADE.exec(word)
    if (glued) return glued[1]!
  }
  return null
}

/**
 * Размер где угодно в строке (без подписи): с пометкой диаметра — «Ø12», «⌀ 16 mm», или строка целиком —
 * типичный диаметр в миллиметрах («12mm», «10 mm», «012MM»): у бирки, снятой боком, подпись «SIZE» бывает
 * обрезана.
 */
export function findMarkedSize(text: string): string | null {
  const match = /(?:^|\s)[Ø⌀ø]\s*(\d{1,2}(?:[.,]\d)?)(?:\s*mm)?(?=$|[\s,;])/iu.exec(text)
  if (match) {
    const size = Number.parseFloat(match[1]!.replace(',', '.'))
    return size >= 4 && size <= 60 ? `${match[1]} mm` : null
  }
  const plain = cleanValue(text)
  if (!/^0?\d{1,2}(?:[.,]5)?\s*(?:mm|мм)$/iu.test(plain)) return null
  const size = readSize(plain, { label: '' })
  return isStrongSize(size) ? String(size) : null
}

/**
 * Диаметр каната (PC strand) из обозначения по EN 10138-3, когда подписи диаметра нет: «Y1860 S7-12,9-F1-C1-R1»
 * (7 проволок, 12,9 мм), «Y1860S7-15,2», «S3-6,5». Пишется как напечатано: «12,9 mm».
 */
export function findStrandSize(text: string): string | null {
  const match = /(?:^|[^\p{L}\d])(?:Y\d{4}\s*)?S[237]G?\s*[-–—]\s*(\d{1,2}[.,]\d{1,2})(?!\d)/iu.exec(text)
  if (!match) return null
  const size = Number.parseFloat(match[1]!.replace(',', '.'))
  return size >= 4 && size <= 20 ? `${match[1]} mm` : null
}

/** Номер партии каната: дата производства ГГММДД, код и группы через дефисы («260909G392-06-2»). */
const STRAND_LOT = /^\d{6}[A-Z0-9]{2,8}(?:-[A-Z0-9]{1,4}){1,3}$/

/** Буквы, которые OCR ставит вместо цифр, — в дате номера партии. */
const DATE_LOOKALIKES: Readonly<Record<string, string>> = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', S: '5', B: '8', Z: '2' }

/**
 * Номер партии каната без подписи (бледную «LOT NO» OCR не узнал или прочёл вместе со значением): слово — код,
 * который начинается с даты производства ГГММДД и идёт через дефисы: «260909G392-06-2» (BPM). Мелкий бледный
 * шрифт OCR портит: пробелы вокруг дефисов и тире, подчёркивание или тильда вместо дефиса, буквы вместо цифр
 * в дате («26O9O9G392-06-2»), пробел посреди номера («260909G 392-06-2» — слово берётся вместе с соседним).
 */
export function findStrandLot(text: string): string | null {
  const words = latinize(cleanValue(text)).toUpperCase().replace(/\s*[-–—_~]\s*/g, '-').split(/\s+/)
    .map((word) => word.replace(/[.,;:]+$/, ''))
  for (const word of [...words, ...words.slice(1).map((next, index) => words[index] + next)]) {
    const fixed = word.slice(0, 6).replace(/[OQDILSBZ|]/g, (char) => DATE_LOOKALIKES[char]!) + word.slice(6)
    if (STRAND_LOT.test(fixed)) return fixed
  }
  return null
}

/**
 * Вес без подписи: строка целиком — вес в килограммах с единицей («2066 kg», «1956.240 KGS») в пределах
 * веса бунта или пачки.
 */
export function findWeightLine(text: string): number | null {
  const value = cleanValue(text)
  if (!/^\d[\d .,]*\s*(?:kg|kgs|кг)$/iu.test(value)) return null
  const kg = readWeightKg(value, { label: '' })
  return isStrongWeight(kg) ? (kg as number) : null
}

/**
 * Номер технического одобрения (агремана): «016-01/593-2025», «016-01-584-2025», с «AT» или без
 * (OCR иногда теряет ноль — «003-1/195-2024» — или вставляет букву перед дефисом — «016i-01-584-2025»).
 */
const APPROVAL = /(?:AT\s*)?(?<!\d)\d{3}(?:[a-z](?=\s*-))?\s*-\s*\d{1,2}\s*[-/]\s*\d{3}\s*-\s*\d{4}(?!\d)/iu

/**
 * Техническое одобрение: номер вида «016-01/593-2025» из значения, иначе код с цифрами как напечатан —
 * если в нём нет длинных слов (подпись, слитая с номером в мусор OCR: «RCAgremonTechnicN-.01E-01/…»).
 */
export const readApproval: ValueReader = (text, context) => {
  const match = APPROVAL.exec(latinize(text))
  if (match) return normalizeApproval(match[0])
  const code = readNumberedCode(text, context)
  return typeof code === 'string' && !/\p{L}{6}/u.test(code) ? code : null
}

/**
 * «AT016-01 / 593-2025» → «AT 016-01/593-2025»: без пробелов внутри номера, «AT» — через пробел;
 * потерянный ноль возвращается («003-1/» → «003-01/»), лишняя буква убирается («016i-» → «016-»).
 */
const normalizeApproval = (text: string) => text.replace(/\s+/g, '').replace(/(?<=\d{3})[a-z](?=-)/i, '')
  .replace(/^AT/i, 'AT ').replace(/(?<=\d{3}-)(\d)(?=[-/])/, '0$1')

/**
 * Техническое одобрение без подписи: номер вида «AT 016-01/593-2025» — сам вид номера его выдаёт
 * (в шапке бирки Çolakoğlu, «NEW AT 016-01/600-2025» у SOVEL).
 */
export function findApproval(text: string): string | null {
  const match = APPROVAL.exec(latinize(text))
  return match ? normalizeApproval(match[0]) : null
}

/**
 * Агреман, который занимает весь текст (кроме приставки страны: «RO-AT 016-01/592-2025»): так он стоит
 * в списке стандартов, но это техническое одобрение.
 */
export function findSoleApproval(text: string): string | null {
  const latin = latinize(text)
  const match = APPROVAL.exec(latin)
  if (!match) return null
  const rest = latin.slice(0, match.index) + latin.slice(match.index + match[0].length)
  return /\d/.test(rest) ? null : normalizeApproval(match[0])
}

/** Изделие без подписи: строка с названием проката (арматура, катанка). */
export function findProduct(text: string): string | null {
  return /rebar|reinforc|wire\s*rod|betonacel|armatur|bar\s+in\s+coil|deformed\s+bar|round\s+bar|beton[cč]eli/iu.test(text)
    ? cleanValue(text)
    : null
}
