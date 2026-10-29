/**
 * Состояние бирки для значков: в углу ячейки сетки и рядом с номером бирки в карточке результата.
 * Чистая функция — для тестов.
 */
import { missingRequiredLabelFields, type LabelFieldDefinition } from '@/features/recognition/label/labelFields'
import { hasProductForm } from '@/features/recognition/label/productForm'
import type { ScanItem } from '../hooks/useScanSession'
import type { HeatDuplicate } from './sendReadiness'

/**
 * Состояние бирки: распознаётся, ошибка, нет фото, нет формы, пусты обязательные поля (или плавка повторяется),
 * готова; `none` — ещё ничего не известно (ждёт очереди, распознавание отменено).
 */
export type TagState = 'busy' | 'failed' | 'noPhoto' | 'noForm' | 'incomplete' | 'done' | 'none'

/**
 * Состояние бирки.
 * @param item Бирка.
 * @param fields Поля из настроек (какие обязательны).
 * @param duplicates Бирки с повторяющейся плавкой (`useHeatDuplicates`).
 */
export function tagState(item: ScanItem, fields: readonly LabelFieldDefinition[], duplicates: ReadonlyMap<string, HeatDuplicate>): TagState {
  if (item.hasError || item.status.kind === 'failed') return 'failed'
  if (item.status.kind === 'recognizing') return 'busy'
  if (item.status.kind !== 'done') return 'none'
  // Переключена обратно «с фото», а снимка нет.
  if (!item.manual && !item.photoUrl) return 'noPhoto'
  if (!hasProductForm(item.status.label)) return 'noForm'
  // Поля по умолчанию обязательны — и у распознанной бирки, и у бирки без фото.
  if (missingRequiredLabelFields(item.status.label, fields).length > 0) return 'incomplete'
  // Плавка повторяется (на экране или в «Загрузках»): такая бирка не отправится.
  if (duplicates.has(item.id)) return 'incomplete'
  return 'done'
}

/** Бирка ждёт действий пользователя (оранжевый «!»): нет фото, формы или обязательных полей, плавка повторяется. */
export const needsAttention = (state: TagState) => state === 'noPhoto' || state === 'noForm' || state === 'incomplete'
