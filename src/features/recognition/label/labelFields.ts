/**
 * Поля, которые модель читает с металлической бирки (ярлык на бунте арматуры / катанки).
 *
 * Набор полей настраивается: встроенные поля (собраны с бирок разных заводов — ArcelorMittal Кривой Рог,
 * Suez Steel, OAM Ózd, SOVEL) можно включать, выключать и переименовывать, а также добавлять свои.
 * Ключ поля — стабильный идентификатор в JSON-ответе модели и в сохранённых записях; название —
 * то, что видит пользователь (английское обязательно, остальные языки — по желанию).
 * Названия встроенных полей по умолчанию — в `locales/<язык>/label.json`.
 */
import type { Language } from '@/i18n/languages'

/** Ключ поля бирки (`snake_case`), например `heat` или `customer_ref`. */
export type LabelKey = string

/** Значение поля: текст или число, прочитанные моделью, `null`, если нечитаемо. */
export type LabelValue = string | number | null

/** Все поля одной распознанной бирки. */
export type LabelRecord = Record<LabelKey, LabelValue>

/**
 * Вид значения — от него зависят клавиатура в режиме правки и подсказка модели о формате.
 * `code` — номера и коды (заглавные, без автозамены), `text` — названия, `number`, `weight` (кг), `date`, `time`.
 */
export type LabelFieldKind = 'code' | 'text' | 'number' | 'weight' | 'date' | 'time'

/** Названия поля на языках интерфейса; английское обязательно. */
export type LabelFieldNames = { en: string } & Partial<Record<Exclude<Language, 'en'>, string>>

/** Описание одного поля в настройках. */
export interface LabelFieldDefinition {
  /** Ключ в JSON-ответе модели; у своих полей создаётся из английского названия и дальше не меняется. */
  key: LabelKey
  /**
   * Названия, заданные пользователем. У встроенных полей пустые значения означают
   * «название по умолчанию из переводов»; у своих полей английское всегда задано.
   */
  names: Partial<LabelFieldNames>
  /** Пояснение для модели (по-английски): что это за поле и как его искать на бирке. */
  hint: string
  /** Вид значения. */
  kind: LabelFieldKind
  /** Читать ли поле с фото. */
  enabled: boolean
  /** Встроенное поле (его нельзя удалить, только выключить или переименовать). */
  builtIn: boolean
}

/** Встроенное поле: ключ, вид и пояснение для модели. Названия — в переводах (`label:fields.<ключ>`). */
interface BuiltInField {
  key: LabelKey
  kind: LabelFieldKind
  hint: string
}

/**
 * Встроенные поля в порядке показа: от изделия к производству, заказу и идентификаторам.
 * Пояснения написаны по-английски — на нём модели лучше всего понимают инструкции.
 */
export const BUILT_IN_FIELDS: readonly BuiltInField[] = [
  { key: 'producer', kind: 'text', hint: 'Steel mill / manufacturer name, e.g. "ArcelorMittal Kryvyi Rih", "Suez Steel Co", "OAM Ózdi Acélművek Kft.", "SOVEL".' },
  { key: 'product', kind: 'text', hint: 'Product type as printed, e.g. "Rebar in coil", "Alloy Rebar", "High ductility weldable reinforcing steel".' },
  { key: 'grade', kind: 'code', hint: 'Steel grade / class / quality (Grade, Class, Clasa, Quality, Minőség, Jakość), e.g. "B500C". Do not include standards.' },
  { key: 'standard', kind: 'code', hint: 'Standard(s) the product conforms to, e.g. "ST 009:2011", "EN ISO 15630-1:2019", "DIN 488". Several standards: join with "; ".' },
  { key: 'technical_approval', kind: 'code', hint: 'Technical approval / agreement / technical documentation number, often "AT 016-01/600-2025" or "016-01-584-2025" (labels: AT, Technical agreement no., Technical doc., Agrement Tehnic).' },
  { key: 'quality_doc', kind: 'code', hint: 'Quality certificate / inspection document number, only if printed on the tag (Certificate No., Inspection certificate 3.1, Certificat de calitate, Сертификат качества), e.g. "3.1 No 125478". Usually absent — then null.' },
  { key: 'size', kind: 'code', hint: 'Bar size / nominal diameter with unit as on the tag (Size, Dimensiune, Diameter, Átmérő, Przekrój), e.g. "8 mm", "12 mm", "R20". A bare number in a "mm" row becomes "<n> mm".' },
  { key: 'heat', kind: 'code', hint: 'Heat (melt) number: Heat, Heat No, Charge, Șarjă/Sarja, Adag, Wytop, Плавка. E.g. "251216", "25R00581".' },
  { key: 'batch', kind: 'code', hint: 'Batch / coil / bundle / package / lot number (Batch, Coil No, Partea/Numărul rulului, Package, Köteg, Paczka, Lot), e.g. "4657 / 30", "581".' },
  { key: 'weight_kg', kind: 'weight', hint: 'Net weight in kilograms as a number (Weight, Greutatea, Tömeg, Waga). Convert tonnes to kg ("2.0 Ton Approx" → 2000).' },
  { key: 'bar_count', kind: 'number', hint: 'Number of bars / pieces in the bundle (N. of bars) as a number.' },
  { key: 'production_date', kind: 'date', hint: 'Production / printing date (Date, P.Date, Dátum, Data) in ISO format YYYY-MM-DD. Tags write day first (22/12/2025 → 2025-12-22) unless the year comes first.' },
  { key: 'production_time', kind: 'time', hint: 'Production time in 24-hour format HH:MM or HH:MM:SS ("11:27 AM" → "11:27").' },
  { key: 'shift', kind: 'code', hint: 'Production shift (Shift No, Schimb), e.g. "3".' },
  { key: 'contract', kind: 'code', hint: 'Contract number (Contract №), e.g. "9Q-2024 / 9Q0620".' },
  { key: 'work_order', kind: 'code', hint: 'Work order / production order number, e.g. "RL0141/2025_F".' },
  { key: 'customer_name', kind: 'text', hint: 'Customer / buyer company name (Customer Name), e.g. "INTERTRANSCOM".' },
  { key: 'destination', kind: 'text', hint: 'Destination or customer country (Destination, Destinație, Customer Country), e.g. "Romania".' },
  { key: 'customer_ref', kind: 'code', hint: 'Customer or buyer reference number (Customer ref., Cumpărător ref. nr., Comparator ref), e.g. "B00271408".' },
  { key: 'serial_number', kind: 'code', hint: 'Tag serial number or product code (Serial Number, Code, Cod), e.g. "L620037025A2260104", "4985800". Not barcode digits unless nothing else is printed.' },
  { key: 'mark', kind: 'code', hint: 'Rolling / brand mark or size mark (Mark, Rolling mark, Hengerlési azonosító, Size Mark Color), e.g. "HADIDNA", "8/7".' },
  { key: 'packing', kind: 'text', hint: 'Packing / form of delivery (Packing), e.g. "12m bundle", "coil".' },
  { key: 'origin_country', kind: 'text', hint: 'Country of origin (Made in, Produs în, Producer country), e.g. "Ukraine", "Hungary".' },
]

/** Ключи встроенных полей. */
export const BUILT_IN_KEYS: readonly LabelKey[] = BUILT_IN_FIELDS.map((field) => field.key)

/**
 * Поля, включённые по умолчанию: то, что идёт в журнал проб, — производитель, размер, номер плавки
 * и вес. Остальные встроенные поля (в том числе марка стали и документ качества) есть в списке,
 * но выключены — их включают по желанию.
 */
export const DEFAULT_ENABLED_KEYS: readonly LabelKey[] = ['producer', 'size', 'heat', 'weight_kg']

/** Включено ли встроенное поле по умолчанию. */
export const isEnabledByDefault = (key: LabelKey) => DEFAULT_ENABLED_KEYS.includes(key)

/** Набор полей по умолчанию: все встроенные поля, включены четыре основных, названия — из переводов. */
export function createDefaultLabelFields(): LabelFieldDefinition[] {
  return BUILT_IN_FIELDS.map((field) => ({ ...field, names: {}, enabled: isEnabledByDefault(field.key), builtIn: true }))
}

/** Набор полей совпадает со стандартным: только встроенные, в исходном порядке, включены основные, без своих названий. */
export const isDefaultLabelFields = (fields: readonly LabelFieldDefinition[]) =>
  fields.length === BUILT_IN_FIELDS.length
  && fields.every((field, index) => field.builtIn && field.key === BUILT_IN_FIELDS[index]!.key
    && field.enabled === isEnabledByDefault(field.key) && Object.keys(field.names).length === 0)

/** Включённые поля в порядке показа. */
export const enabledLabelFields = (fields: readonly LabelFieldDefinition[]) => fields.filter((field) => field.enabled)

/**
 * Ключ своего поля из английского названия: `snake_case` латиницей, уникальный среди `taken`.
 * «Size mark color» → `size_mark_color`; повтор → `size_mark_color_2`.
 */
export function createLabelKey(englishName: string, taken: readonly LabelKey[]): LabelKey {
  const base = englishName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'field_$1') || 'field'
  let key = base
  for (let index = 2; taken.includes(key); index++) key = `${base}_${index}`
  return key
}

/** Нет ли у поля пригодного значения. */
export const isMissingValue = (value: LabelValue | undefined) => value === null || value === undefined || value === ''

/**
 * Обязательные поля бирки без фото: поля по умолчанию (то, что идёт в журнал проб: производитель,
 * размер, номер плавки, вес), если они включены в настройках. Распознанную бирку они не ограничивают.
 */
export const requiredManualFields = (fields: readonly LabelFieldDefinition[]) =>
  enabledLabelFields(fields).filter((field) => isEnabledByDefault(field.key))

/** Обязательные поля бирки без фото, которые ещё не заполнены. */
export const missingManualFields = (label: LabelRecord, fields: readonly LabelFieldDefinition[]) =>
  requiredManualFields(fields).filter((field) => isMissingValue(label[field.key]))
