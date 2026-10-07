import englishLabel from '@/locales/en/label.json'
import type { LabelFieldDefinition, LabelFieldKind } from './labelFields'

/**
 * Инструкция по умолчанию, отправляемая с каждым фото (её можно изменить в настройках).
 * Написана по-английски: так модели точнее следуют правилам; ответ — JSON, поэтому язык интерфейса не важен.
 * Список полей с пояснениями и форма JSON добавляются к ней автоматически (`buildLabelPrompt`).
 */
export const DEFAULT_LABEL_INSTRUCTIONS = `You are reading a photo of a metal identification tag attached to a coil or bundle of steel reinforcing bar (rebar, wire rod). Tags come from different mills and countries and may be multilingual: English, Romanian, Hungarian, Polish, Greek, Ukrainian, Russian, Arabic. The photo may be rotated, taken at an angle, glossy, dirty, rusty or partly torn.

Extract the fields listed below and reply with ONE JSON object only: no markdown, no code fences, no comments, no extra keys.

Rules:
1. Copy values exactly as printed. Keep letters, digits, slashes, dashes, dots, underscores and inner spaces; keep leading zeros (e.g. "9Q-2024 / 9Q0620", "L620037025A2260104", "25R00581"). Do not translate values.
2. Labels differ between mills and languages: match fields by meaning, not by exact wording. A value belongs to the label on the same row, or directly below/next to it in the same cell; read rotated tables in their own orientation.
3. Characters that look alike (0/O, 1/I/l, 5/S, 8/B, 2/Z): decide from context — heat, batch and serial numbers are usually digits, grades look like "B500C".
4. Numbers: "weight"-type fields are numbers in kilograms (convert tonnes: "2.0 Ton" → 2000; "1990 Kg" → 1990); count fields are plain numbers. Values marked "Approx" are still returned as numbers.
5. Dates are ISO "YYYY-MM-DD"; tags write the day first (04/01/2026 → 2026-01-04) unless the year comes first. Times are 24-hour "HH:MM" or "HH:MM:SS".
6. If the same value is printed twice (for example on a tear-off stub), use the most legible copy and make sure both agree.
7. Never decode barcodes, QR or DataMatrix codes, and never invent or complete partially hidden values. If a field is absent, unreadable, covered by rust or paint, or you are not sure — use null.
8. Ignore addresses, websites, certification-body boilerplate and marketing text unless a field asks for them.`

/** Подсказка модели о формате значения по виду поля. */
const KIND_FORMAT: Record<LabelFieldKind, string> = {
  code: 'string, exactly as printed',
  text: 'string',
  number: 'number',
  weight: 'number, kilograms',
  date: 'string, YYYY-MM-DD',
  time: 'string, HH:MM or HH:MM:SS',
}

/** Английское название поля для модели: заданное пользователем, у встроенных — из английских переводов. */
function englishName(field: LabelFieldDefinition): string {
  const own = field.names.en?.trim()
  if (own) return own
  const builtIn = (englishLabel.fields as Record<string, string | undefined>)[field.key]
  return builtIn ?? field.key
}

/** Ключ ответа с оценкой фото; ключи полей с `_` не начинаются (см. `createLabelKey`). */
export const PHOTO_ASSESSMENT_KEY = '_photo'

/** Правило оценки качества фото — добавляется к любой инструкции, в том числе своей. */
const PHOTO_ASSESSMENT_RULE = `Also judge the photo itself in "${PHOTO_ASSESSMENT_KEY}": "ok" is false only when a photo problem that a retake could fix makes at least one value printed on the tag unreadable or uncertain; otherwise true. "issues" lists the problems using only these codes: "blurry" (out of focus or motion blur), "glare" (reflection or flash hides text), "dark", "overexposed", "cropped" (part of the tag is outside the frame), "angle" (strong tilt or perspective distorts text), "far" (tag too small in the frame), "obstructed" (fingers, objects or shadow cover text), "noTag" (no identification tag in the photo). Rust, dirt or damage on the tag itself is not a photo problem.`

/**
 * Правило известных поставщиков: список — подсказка для плохо читаемых названий заводов, а не замена
 * прочитанному. Чётко напечатанное название переписывается как есть, ничего не указывающее
 * на поставщика — `null`, а не угаданное название из списка.
 */
function knownSuppliersRule(suppliers: readonly string[]): string {
  const list = suppliers.map((name) => `- ${name}`).join('\n')
  return `Known suppliers (steel mills this warehouse receives from):\n${list}\nUse this list only for fields that name the manufacturer / steel mill. If the printed name is partly unreadable, worn or you are unsure of some letters, and what you can read clearly points to one supplier above (similar spelling, abbreviation, logo text), return that supplier's name as written in the list instead of guessing letters. If the name is clearly legible, copy it as printed even when it differs from the list — a new supplier is possible. Never pick a supplier when nothing on the tag points to it; use null instead.`
}

/** JSON-заготовка с полями, равными `null`, в порядке списка, и оценкой фото в конце. */
export function labelJsonTemplate(fields: readonly LabelFieldDefinition[]): string {
  const shape = Object.fromEntries<unknown>(fields.map((field) => [field.key, null]))
  shape[PHOTO_ASSESSMENT_KEY] = { ok: true, issues: [] }
  return JSON.stringify(shape, null, 2)
}

/**
 * Полный промпт: инструкция (своя или по умолчанию), список полей с английскими названиями,
 * форматом и пояснениями, правило оценки качества фото и JSON-заготовка. Часть про поля строится автоматически, поэтому промпт
 * никогда не расходится с выбранными полями. Если задан список известных поставщиков, он идёт после полей.
 * @param instructions Инструкция из настроек; пустая строка — инструкция по умолчанию.
 * @param fields Включённые поля в порядке показа.
 * @param suppliers Известные поставщики из настроек; пустой список — правило не добавляется.
 */
export function buildLabelPrompt(instructions: string, fields: readonly LabelFieldDefinition[], suppliers: readonly string[] = []): string {
  const text = instructions.trim() || DEFAULT_LABEL_INSTRUCTIONS
  const list = fields
    .map((field) => {
      const name = englishName(field)
      const hint = field.hint.trim()
      return `- "${field.key}" — ${name} (${KIND_FORMAT[field.kind]})${hint ? `: ${hint}` : ''}`
    })
    .join('\n')
  const supplierRule = suppliers.length > 0 ? `\n\n${knownSuppliersRule(suppliers)}` : ''
  return `${text}\n\nFields:\n${list}${supplierRule}\n\n${PHOTO_ASSESSMENT_RULE}\n\nReturn exactly this JSON shape, with null for every field you cannot read:\n${labelJsonTemplate(fields)}`
}
