/**
 * Выбор производителя в правке бирки: известные поставщики из настроек списком, а распознанное (или вписанное)
 * название, которого в списке нет, — отдельным вариантом, чтобы оно не потерялось. Чистые функции — для тестов.
 */
import { supplierKey } from '@/features/recognition/label/knownSuppliers'

/** Вариант «Свой вариант…»: вместо выбора — поле ввода (значение не совпадает ни с одним названием). */
export const OWN_PRODUCER = '\u0000own'

/** Что показывает выбор для текущего значения. */
export interface ProducerChoice {
  /** Выбранный вариант: поставщик из списка (написанием из списка) или само значение; пустое — не выбран. */
  selected: string
  /** Значение не из списка — отдельный вариант; `null`, если оно в списке или пустое. */
  unlisted: string | null
}

/**
 * Выбор для значения поля: поставщик из списка совпадает без учёта регистра и лишних пробелов
 * («SOVEL» — это «Sovel»), иначе значение — отдельный вариант «не из списка».
 * @param value Текущее значение поля производителя.
 * @param suppliers Известные поставщики из настроек.
 */
export function producerChoice(value: string, suppliers: readonly string[]): ProducerChoice {
  const text = value.trim()
  if (!text) return { selected: '', unlisted: null }
  const listed = suppliers.find((name) => supplierKey(name) === supplierKey(text))
  return listed ? { selected: listed, unlisted: null } : { selected: text, unlisted: text }
}
