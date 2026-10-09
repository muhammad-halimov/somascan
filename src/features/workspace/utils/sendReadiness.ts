/**
 * Готова ли бирка к отправке в журнал и что именно уходит в очередь. Чистые функции (без React),
 * их использует «Далее» (`useSendSelected`) и проверяют тесты.
 */
import { enabledLabelFields, missingManualFields, SHEET_KEY, type LabelFieldDefinition, type LabelRecord } from '@/features/recognition/label/labelFields'
import { hasProductForm } from '@/features/recognition/label/productForm'
import type { ScanItem } from '../hooks/useScanSession'

/** Незаполненные обязательные поля бирки без фото (у распознанной обязательных нет). */
export const missingRequiredFields = (item: ScanItem, fields: readonly LabelFieldDefinition[]) =>
  item.manual && item.status.kind === 'done' ? missingManualFields(item.status.label, fields) : []

/** Бирка ждёт фото: её переключили обратно «с фото», а снимка нет. */
export const awaitsPhoto = (item: ScanItem) => !item.manual && !item.photoUrl

/**
 * Бирка готова к отправке: распознана (или заполнена вручную — «без фото»), выбрана форма,
 * у бирки без фото заполнены обязательные поля.
 */
export const isReadyToSend = (item: ScanItem, fields: readonly LabelFieldDefinition[]) =>
  item.status.kind === 'done' && !awaitsPhoto(item)
  && hasProductForm(item.status.label) && missingRequiredFields(item, fields).length === 0

/**
 * Поля бирки для очереди. Свой лист бирки (поле «Лист») уходит в запись, только если поле включено
 * и лист выбран; иначе лист берётся из настроек хранилища в момент записи.
 */
export function labelForQueue(label: LabelRecord, fields: readonly LabelFieldDefinition[]): LabelRecord {
  const { [SHEET_KEY]: sheet, ...rest } = label
  const ownSheet = enabledLabelFields(fields).some((field) => field.key === SHEET_KEY)
  return ownSheet && typeof sheet === 'string' && sheet.trim() !== '' ? { ...rest, [SHEET_KEY]: sheet } : rest
}
