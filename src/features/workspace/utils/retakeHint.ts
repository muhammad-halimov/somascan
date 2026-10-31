/**
 * Подсказка поверх фото, когда бирка распознана не полностью: что мешает и что сделать. Причина — первая проблема фото
 * в порядке `PHOTO_ISSUES` (её назвала модель, локальная проверка или прочтение на устройстве: «бирка повёрнута»,
 * «текст мелкий или бледный»), иначе — просто «не все поля распознаны». Чистая функция — для тестов.
 */
import { PHOTO_ISSUES, type PhotoIssue } from '@/features/recognition/image/PhotoQuality'
import { missingRequiredLabelFields, type LabelFieldDefinition } from '@/features/recognition/label/labelFields'
import type { ScanItem } from '../hooks/useScanSession'

/** Причина подсказки: проблема фото или «не все обязательные поля распознаны». */
export type RetakeHintReason = PhotoIssue | 'missing'

/**
 * Какую подсказку показать на фото бирки.
 * @param item Открытая бирка (`null` — пустая ячейка).
 * @param fields Поля из настроек.
 * @returns Причина или `null` — подсказка не нужна (всё распознано, нет фото, ещё распознаётся).
 */
export function retakeHintReason(item: ScanItem | null, fields: readonly LabelFieldDefinition[]): RetakeHintReason | null {
  if (!item || item.manual || !item.photoUrl || item.status.kind !== 'done') return null
  const { photo, label } = item.status
  if (!photo.retake && missingRequiredLabelFields(label, fields).length === 0) return null
  return PHOTO_ISSUES.find((issue) => photo.issues.includes(issue)) ?? 'missing'
}
