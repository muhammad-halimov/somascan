/**
 * Правила полей бирки для распознавания на устройстве: как поле подписано на бирках разных заводов
 * (подписи — `ruleLabels.ts`, их можно менять в настройках) и как читается его значение.
 *
 * Подписи сравниваются без регистра, диакритики, пробелов и знаков (`foldText`), поэтому «Heat No», «HEAT NO.»
 * и «heat no:» — одна подпись. Если одна подпись — часть другой («product» в «production date»),
 * побеждает более длинная. Свои поля пользователя ищутся по их названиям на всех языках.
 */
import type { LabelFieldDefinition, LabelFieldKind, LabelKey, LabelValue } from '../label/labelFields'
import { foldText } from './foldText'
import { ruleLabelsFor } from './ruleLabels'
import {
  isStrongGrade, isStrongHeat, isStrongSize, isStrongWeight, readApproval, readCode, readCount, readDate, readGrade, readHeat,
  readNumberedCode, readSize, readStandard, readText, readTime, readWeightKg, type ValueReader,
} from './valueReaders'

/** Правило одного поля. */
export interface FieldRule {
  /** Ключ поля. */
  key: LabelKey
  /** Подписи поля в сложенном виде (`foldText`). */
  labels: readonly string[]
  /** Чтение значения. */
  read: ValueReader
  /** Значение выглядит ровно как значение этого поля (плавка `25R00581`, размер `12 mm`): такой кандидат сильнее. */
  strong?: (value: LabelValue) => boolean
  /** Значений может быть несколько (стандарты): собираются все, через «; ». */
  multi?: boolean
  /**
   * Подписи, которые считаются подписью только в начале строки (сложенные): «Kg: 780» — подпись веса,
   * а «2048 kg» — значение.
   */
  leadingLabels?: readonly string[]
}

/** Чтение встроенных полей; их подписи — в `ruleLabels.ts` (их можно менять в «Расширенных» → «Правила»). */
interface BuiltInRule {
  leadingLabels?: readonly string[]
  read: ValueReader
  strong?: (value: LabelValue) => boolean
  multi?: boolean
}

/** Встроенные поля: как читается значение (подписи — `DEFAULT_RULE_LABELS` или изменённые в настройках). */
const BUILT_IN_RULES: Readonly<Record<LabelKey, BuiltInRule>> = {
  producer: {
    read: readText,
  },
  product: {
    read: readText,
  },
  grade: {
    read: readGrade,
    strong: isStrongGrade,
  },
  standard: {
    read: readStandard,
    multi: true,
  },
  technical_approval: {
    read: readApproval,
  },
  quality_doc: {
    read: readNumberedCode,
  },
  size: {
    read: readSize,
    strong: isStrongSize,
  },
  heat: {
    read: readHeat,
    strong: isStrongHeat,
  },
  batch: {
    read: readNumberedCode,
  },
  weight_kg: {
    leadingLabels: ['kg', 'кг'],
    read: readWeightKg,
    strong: isStrongWeight,
  },
  bar_count: {
    read: readCount,
  },
  production_date: {
    read: readDate,
  },
  production_time: {
    read: readTime,
  },
  shift: {
    read: readCode,
  },
  contract: {
    read: readNumberedCode,
  },
  work_order: {
    read: readNumberedCode,
  },
  customer_name: {
    read: readText,
  },
  destination: {
    read: readText,
  },
  customer_ref: {
    read: readNumberedCode,
  },
  serial_number: {
    read: readNumberedCode,
  },
  mark: {
    read: readCode,
  },
  packing: {
    read: readText,
  },
  origin_country: {
    read: readText,
  },
}

/** Чтение своих полей по их виду. */
const KIND_READERS: Readonly<Record<LabelFieldKind, ValueReader>> = {
  code: readCode,
  text: readText,
  number: readCount,
  weight: readWeightKg,
  date: readDate,
  time: readTime,
}

/** Подписи без повторов и пустых, в сложенном виде. */
const foldLabels = (labels: readonly string[]) => [...new Set(labels.map(foldText).filter((label) => label.length >= 2))]

/** Названия поля, заданные пользователем, на всех языках. */
const ownNames = (field: LabelFieldDefinition) => Object.values(field.names).filter((name): name is string => typeof name === 'string')

/**
 * Правила для разбора бирки: все встроенные поля (подписи выключенных тоже нужны — их значения не должны
 * достаться другим полям) и свои поля из настроек. Названия, заданные пользователем, — тоже подписи.
 * @param fields Поля из настроек (включённые и выключенные).
 * @param ruleLabels Подписи, изменённые в «Расширенных» → «Правила» (остальные — стандартные).
 */
export function buildFieldRules(fields: readonly LabelFieldDefinition[], ruleLabels: Readonly<Record<string, readonly string[]>> = {}): FieldRule[] {
  const byKey = new Map(fields.map((field) => [field.key, field]))
  const rules: FieldRule[] = Object.entries(BUILT_IN_RULES).map(([key, rule]) => {
    const field = byKey.get(key)
    return {
      key,
      ...rule,
      labels: foldLabels([...ruleLabelsFor(ruleLabels, key), ...(field ? ownNames(field) : [])]),
      ...(rule.leadingLabels ? { leadingLabels: foldLabels(rule.leadingLabels) } : {}),
    }
  })
  for (const field of fields) {
    if (field.builtIn || field.manual || field.key in BUILT_IN_RULES) continue
    rules.push({ key: field.key, labels: foldLabels(ownNames(field)), read: KIND_READERS[field.kind] })
  }
  return rules
}
