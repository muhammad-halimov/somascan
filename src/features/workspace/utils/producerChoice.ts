/**
 * Производитель в правке бирки: известные поставщики из настроек — выпадающим списком, своё название
 * вписывается карандашом. Чистая функция — для тестов.
 */
import { supplierKey } from '@/features/recognition/label/knownSuppliers'

/**
 * Поставщик из списка, которому соответствует значение поля (без учёта регистра и лишних пробелов:
 * «SOVEL» — это «Sovel»), написанием из списка; `null` — значение пустое или не из списка.
 * @param value Текущее значение поля производителя.
 * @param suppliers Известные поставщики из настроек.
 */
export function listedSupplier(value: string, suppliers: readonly string[]): string | null {
  const text = value.trim()
  if (!text) return null
  return suppliers.find((name) => supplierKey(name) === supplierKey(text)) ?? null
}

/**
 * Поставщики в порядке списка выбора: выбранный (из списка) — первым, остальные — по алфавиту, как в настройках.
 * @param suppliers Известные поставщики из настроек.
 * @param chosen Выбранный поставщик из списка (`listedSupplier`) или `null`.
 */
export function supplierChoices(suppliers: readonly string[], chosen: string | null): string[] {
  return chosen === null ? [...suppliers] : [chosen, ...suppliers.filter((name) => name !== chosen)]
}
