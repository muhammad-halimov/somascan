/**
 * Готова ли бирка к отправке в журнал и что именно уходит в очередь. Чистые функции (без React),
 * их использует «Далее» (`useSendSelected`) и проверяют тесты.
 */
import { HEAT_KEY, heatKey } from '@/features/recognition/label/heatNumber'
import { enabledLabelFields, missingRequiredLabelFields, SHEET_KEY, type LabelFieldDefinition, type LabelRecord } from '@/features/recognition/label/labelFields'
import { hasProductForm } from '@/features/recognition/label/productForm'
import type { ScanItem } from '../hooks/useScanSession'

/** Незаполненные обязательные поля бирки — распознанной с фото или заполненной вручную. */
export const missingRequiredFields = (item: ScanItem, fields: readonly LabelFieldDefinition[]) =>
  item.status.kind === 'done' ? missingRequiredLabelFields(item.status.label, fields) : []

/** С чем совпала плавка бирки: с биркой раньше на экране (её номер) или с записью в «Загрузках». */
export type HeatDuplicate =
  | { kind: 'tag'; number: number }
  | { kind: 'sent'; localNumber: string }

/** Запись «Загрузок» — по ней видно уже отправленные плавки. */
export interface SentLabel {
  /** Номер записи (`SCN-…`). */
  localNumber: string
  /** Поля бирки. */
  label: LabelRecord
}

/**
 * Повторы плавок у бирок на экране (по id бирки). Плавка, которая уже есть в «Загрузках» (в очереди или
 * записана), — повтор у всех бирок с ней; иначе первая бирка с плавкой остаётся, повторы — следующие.
 * Журнал на сервере сверяет запись (`LabelWorkbook.append`, `duplicateHeat`).
 */
export function heatDuplicates(items: readonly ScanItem[], sent: readonly SentLabel[]): ReadonlyMap<string, HeatDuplicate> {
  const sentHeats = new Map<string, string>()
  for (const record of sent) {
    const key = heatKey(record.label[HEAT_KEY])
    if (key && !sentHeats.has(key)) sentHeats.set(key, record.localNumber)
  }
  const firstOnScreen = new Map<string, number>()
  const duplicates = new Map<string, HeatDuplicate>()
  items.forEach((item, index) => {
    if (item.status.kind !== 'done') return
    const key = heatKey(item.status.label[HEAT_KEY])
    if (!key) return
    const localNumber = sentHeats.get(key)
    const first = firstOnScreen.get(key)
    if (localNumber) duplicates.set(item.id, { kind: 'sent', localNumber })
    else if (first !== undefined) duplicates.set(item.id, { kind: 'tag', number: first + 1 })
    else firstOnScreen.set(key, index)
  })
  return duplicates
}

/** Бирка ждёт фото: её переключили обратно «с фото», а снимка нет. */
export const awaitsPhoto = (item: ScanItem) => !item.manual && !item.photoUrl

/**
 * Бирка готова к отправке: распознана (или заполнена вручную — «без фото»), выбрана форма,
 * заполнены обязательные поля (что не распознала модель — дописывают в правке), плавка не повторяется
 * (`heatDuplicates`).
 */
export const isReadyToSend = (item: ScanItem, fields: readonly LabelFieldDefinition[], duplicates: ReadonlyMap<string, HeatDuplicate> = new Map()) =>
  item.status.kind === 'done' && !awaitsPhoto(item)
  && hasProductForm(item.status.label) && missingRequiredFields(item, fields).length === 0
  && !duplicates.has(item.id)

/**
 * Поля бирки для очереди. Свой лист бирки (поле «Лист») уходит в запись, только если поле включено
 * и лист выбран; иначе лист берётся из настроек хранилища в момент записи.
 */
export function labelForQueue(label: LabelRecord, fields: readonly LabelFieldDefinition[]): LabelRecord {
  const { [SHEET_KEY]: sheet, ...rest } = label
  const ownSheet = enabledLabelFields(fields).some((field) => field.key === SHEET_KEY)
  return ownSheet && typeof sheet === 'string' && sheet.trim() !== '' ? { ...rest, [SHEET_KEY]: sheet } : rest
}
