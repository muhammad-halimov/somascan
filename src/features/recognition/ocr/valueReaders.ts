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
 * без «No» и знаков. Пробелы внутри сводятся к одному.
 */
export function cleanValue(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;.,\-–—/\\|#№*()[\]]+/u, '')
    .replace(/^(?:no|nr|n°|nº|num|number)(?=[\s.:#№]|$)[\s.:#№]*/iu, '')
    .replace(/[\s:;,\-–—/\\|*(]+$/u, '')
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

/** Код как напечатан (без «No», лишних знаков и пробелов), кириллические двойники — латиницей. */
export const readCode: ValueReader = (text) => {
  const value = latinize(cleanValue(text))
  return /[\p{L}\p{N}]/u.test(value) && value.length <= 40 ? value : null
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

/**
 * Номер плавки: «251216», «25R00581». Пробел внутри короткого номера убирается («25R 00581»),
 * буквы-двойники рядом с цифрами становятся цифрами.
 */
export const readHeat: ValueReader = (text) => {
  const value = latinize(cleanValue(text)).toUpperCase()
  const words = value.split(/[\s/]+/).map((word) => word.replace(/[.,;:]+$/, ''))
  const compact = value.replace(/\s+/g, '')
  const options = words.length <= 2 && compact.length <= 10 ? [compact, ...words] : words
  for (const option of options) {
    const heat = fixDigitLookalikes(option)
    if (HEAT.test(heat) && digitCount(heat) >= 3) return heat
  }
  return null
}

/** Похож ли номер на плавку уверенно: 5–12 знаков, из них хотя бы четыре цифры. */
export const isStrongHeat = (value: LabelValue) =>
  typeof value === 'string' && value.length >= 5 && value.length <= 12 && digitCount(value) >= 4 && !value.includes('-')

/** Размер: пометка (Ø, D — диаметр, R — гладкий пруток), число от 4 до 60, необязательно «mm». */
const SIZE = /^(?:(Ø|⌀|ø|diam\.?|D|R)\s*)?(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:mm|мм)?(?=$|[\s,;/x×*])/iu

/**
 * Размер (номинальный диаметр): «12» в строке «(mm)» → «12 mm», «Ø12», «12mm» → «12 mm», «R20» — как есть.
 */
export const readSize: ValueReader = (text) => {
  const match = SIZE.exec(fixDigitLookalikes(cleanValue(text)))
  if (!match) return null
  const number = match[2]!
  const size = Number.parseFloat(number.replace(',', '.'))
  if (!(size >= 4 && size <= 60)) return null
  return match[1]?.toUpperCase() === 'R' ? `R${number}` : `${number} mm`
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
  const match = AMOUNT.exec(value)
  if (!match) return null
  const raw = match[0]
  const unit = weightUnit(value.slice(match.index + raw.length)) ?? weightUnit(context.label)
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

/** Марка стали как код (буквы-двойники рядом с цифрами — цифры: «B5OOC» → «B500C»). */
export const readGrade: ValueReader = (text, context) => {
  const value = readCode(text, context)
  return typeof value === 'string' ? fixDigitLookalikes(fixDigitLookalikes(value)) : null
}

/** Похоже ли значение на марку стали. */
export const isStrongGrade = (value: LabelValue) => typeof value === 'string' && GRADE.test(value.toUpperCase())

/** Марка стали где угодно в строке (без подписи): отдельное слово вида «B500C». */
export function findGrade(text: string): string | null {
  for (const word of latinize(text).toUpperCase().split(/[\s/,;:()]+/)) {
    if (/^(?:B|BST|A|K)\d{3}[A-Z]{1,2}$/.test(word)) return word
  }
  return null
}

/** Размер где угодно в строке (без подписи): только с пометкой диаметра — «Ø12», «⌀ 16 mm». */
export function findMarkedSize(text: string): string | null {
  const match = /(?:^|\s)[Ø⌀ø]\s*(\d{1,2}(?:[.,]\d)?)(?:\s*mm)?(?=$|[\s,;])/iu.exec(text)
  if (!match) return null
  const size = Number.parseFloat(match[1]!.replace(',', '.'))
  return size >= 4 && size <= 60 ? `${match[1]} mm` : null
}

/** Изделие без подписи: строка с названием проката (арматура, катанка). */
export function findProduct(text: string): string | null {
  return /rebar|reinforc|wire\s*rod|betonacel|armatur|bar\s+in\s+coil|deformed\s+bar|round\s+bar|beton[cč]eli/iu.test(text)
    ? cleanValue(text)
    : null
}
