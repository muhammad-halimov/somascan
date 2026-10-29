/**
 * Когда подсказать «Попробуйте повернуть фото»: бирка с фото распознана, но пусты
 * обязательные поля или распознавание (модель, локальная проверка) советует переснять. Чистая функция — для тестов.
 */
import { missingRequiredLabelFields, type LabelFieldDefinition } from '@/features/recognition/label/labelFields'
import type { ScanItem } from '../hooks/useScanSession'

/**
 * Нужна ли подсказка повернуть или переснять фото бирки.
 * @param item Открытая бирка (`null` — пустая ячейка).
 * @param fields Поля из настроек.
 */
export function needsRetakeHint(item: ScanItem | null, fields: readonly LabelFieldDefinition[]): boolean {
  if (!item || item.manual || !item.photoUrl || item.status.kind !== 'done') return false
  return item.status.photo.retake || missingRequiredLabelFields(item.status.label, fields).length > 0
}
