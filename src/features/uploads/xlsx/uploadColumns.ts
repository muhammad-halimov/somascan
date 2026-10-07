/**
 * Колонки своих полей бирки для записи в журнал.
 *
 * Набор фиксируется в момент нажатия «Далее»: по одной колонке на каждое включённое поле.
 * Известные колонки журнала (Nr. Crt., Cantitatea, Sarja, Producator, Ø Bobina/Bara…) находятся
 * по шапке сами (`labTableLayout`), а эти нужны, чтобы заполнить колонку, которую добавили
 * в журнал под какое-то поле: она узнаётся по любому из названий поля — ключу, названию
 * на любом языке интерфейса или своему названию. Колонок, которых в журнале нет, приложение не добавляет.
 */
import type { LabelFieldDefinition, LabelFieldKind } from '@/features/recognition/label/labelFields'
import { LANGUAGES, type Language } from '@/i18n/languages'
import { resources } from '@/i18n/resources'

/**
 * Вид колонки: вид поля бирки. `record_number` и `recorded_at` — служебные колонки прежних версий
 * (записи, поставленные в очередь до обновления, ещё могут их содержать; при записи они пропускаются).
 */
export type UploadColumnKind = LabelFieldKind | 'record_number' | 'recorded_at'

/** Одна колонка. */
export interface UploadColumn {
  /** Ключ поля бирки. */
  key: string
  /** Название на языке интерфейса в момент «Далее». */
  header: string
  /** Все названия, по которым колонка опознаётся в шапке журнала. */
  aliases: string[]
  /** Вид значения. */
  kind: UploadColumnKind
}

/** Название встроенного поля из переводов. */
const builtInName = (language: Language, key: string): string | undefined =>
  (resources[language].label.fields as Record<string, string | undefined>)[key]

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
 * Колонки для записи — по одной на включённое поле, в порядке показа.
 * @param fields Включённые поля бирки.
 * @param language Язык интерфейса (название поля в записи).
 */
export function buildUploadColumns(fields: readonly LabelFieldDefinition[], language: Language): UploadColumn[] {
  return fields.map((field) => fieldColumn(field, language))
}
