import type { ScanItem } from '../hooks/useScanSession'

/** Что с фото открытой бирки: есть ли оно и не занята ли бирка (фото загружается или распознаётся). */
export interface PhotoState {
  /** Фото есть и открылось. */
  hasPhoto: boolean
  /** Фото ещё загружается или распознаётся (или с телефона принимается новое): поверх фото — ожидание. */
  isBusy: boolean
}

/**
 * Состояние фото открытой бирки — одно для карточки фото (ожидание поверх фото) и панели листания
 * (кнопки масштаба и поворота — только у готового фото).
 * @param isReceiving Принимается новое фото (выбор в галерее, камера).
 */
export function photoState(item: ScanItem | null, isReceiving: boolean): PhotoState {
  const hasError = item?.hasError ?? false
  return {
    hasPhoto: Boolean(item?.photoUrl) && !hasError,
    isBusy: isReceiving || (item !== null && (item.isLoading || item.status.kind === 'recognizing') && !hasError),
  }
}
