/**
 * Колонки таблицы для одной записи.
 *
 * Набор колонок фиксируется в момент нажатия «Далее»: две служебные (номер записи и дата),
 * форма поставки (выбирается вручную) и по одной на каждое включённое поле бирки. Заголовок — название на текущем языке интерфейса,
 * а `aliases` — все известные названия колонки (ключ, названия на всех языках, свои названия),
 * чтобы при записи находить колонку в таблице, даже если заголовки в ней на другом языке
 * или таблицу переформатировали. Колонка, которой нет, добавляется в конец.
 */
import type { LabelFieldDefinition, LabelFieldKind } from '@/features/recognition/label/labelFields'
import { PRODUCT_FORM_KEY } from '@/features/recognition/label/productForm'
import { LANGUAGES, type Language } from '@/i18n/languages'
import { resources } from '@/i18n/resources'

/** Вид колонки: вид поля бирки либо служебная колонка. */
export type UploadColumnKind = LabelFieldKind | 'record_number' | 'recorded_at'

/** Одна колонка таблицы. */
export interface UploadColumn {
  /** Ключ: ключ поля бирки или служебный ключ с `_` в начале (ключи полей так не начинаются). */
  key: string
  /** Заголовок колонки, если её придётся создать. */
  header: string
  /** Все названия, по которым колонка опознаётся в заголовке таблицы. */
  aliases: string[]
  /** Вид значения. */
  kind: UploadColumnKind
}

/** Ключ колонки с собственным номером записи (`SCN-…`); по нему же проверяется, не записана ли строка дважды. */
export const RECORD_NUMBER_KEY = '_record_number'

/** Ключ колонки с датой и временем записи строки в таблицу. */
export const RECORDED_AT_KEY = '_recorded_at'

/** Название встроенного поля из переводов. */
const builtInName = (language: Language, key: string): string | undefined =>
  (resources[language].label.fields as Record<string, string | undefined>)[key]

/** Название служебной колонки из переводов. */
const metaName = (language: Language, column: 'number' | 'recordedAt'): string => resources[language].uploads.columns[column]

/**
 * Прежние заголовки служебных колонок: таблицы, начатые старыми версиями, продолжают
 * заполняться в ту же колонку, а не получают новую.
 */
const LEGACY_META_NAMES: Partial<Record<'number' | 'recordedAt', readonly string[]>> = {
  recordedAt: ['Date and time', 'Data și ora', 'Сана ва вақт', 'Дата и время'],
}

/** Служебная колонка с названиями на всех языках. */
function metaColumn(key: string, kind: UploadColumnKind, column: 'number' | 'recordedAt', language: Language): UploadColumn {
  const aliases = [...LANGUAGES.map((code) => metaName(code, column)), ...(LEGACY_META_NAMES[column] ?? [])]
  return { key, kind, header: metaName(language, column), aliases }
}

/** Колонка формы поставки (значение в таблице — румынское слово `bara` / `bobina`). */
function productFormColumn(language: Language): UploadColumn {
  const nameIn = (code: Language) => resources[code].label.productForm.name
  return { key: PRODUCT_FORM_KEY, kind: 'text', header: nameIn(language), aliases: [PRODUCT_FORM_KEY, ...LANGUAGES.map(nameIn)] }
}

/** Колонка поля бирки: заголовок на языке `language`, псевдонимы — ключ и названия на всех языках. */
function fieldColumn(field: LabelFieldDefinition, language: Language): UploadColumn {
  const nameIn = (code: Language) => field.names[code] ?? (field.builtIn ? builtInName(code, field.key) : undefined)
  const header = nameIn(language) ?? field.names.en ?? field.key
  const aliases = new Set<string>([field.key, header])
  for (const code of LANGUAGES) {
    const name = nameIn(code)
    if (name) aliases.add(name)
  }
  return { key: field.key, kind: field.kind, header, aliases: [...aliases] }
}

/**
 * Колонки для записи: служебные, затем поля в порядке показа.
 * @param fields Включённые поля бирки.
 * @param language Язык заголовков создаваемых колонок.
 */
export function buildUploadColumns(fields: readonly LabelFieldDefinition[], language: Language): UploadColumn[] {
  return [
    metaColumn(RECORD_NUMBER_KEY, 'record_number', 'number', language),
    metaColumn(RECORDED_AT_KEY, 'recorded_at', 'recordedAt', language),
    productFormColumn(language),
    ...fields.map((field) => fieldColumn(field, language)),
  ]
}
