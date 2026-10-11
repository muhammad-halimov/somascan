/**
 * Номер плавки — ключ уникальности бирки: каждая плавка записывается в журнал один раз
 * (повтор на экране, в «Загрузках» или в самом журнале не отправляется).
 */
import type { LabelValue } from './labelFields'

/** Ключ поля «Номер плавки». */
export const HEAT_KEY = 'heat'

/**
 * Плавка для сравнения: без пробелов и в верхнем регистре (`25r 00581` и `25R00581` — одна плавка;
 * число `253830` и текст `"253830"` — тоже). Пустая — `null`.
 */
export function heatKey(value: LabelValue | undefined): string | null {
  if (value === null || value === undefined) return null
  const key = String(value).replace(/\s+/g, '').toUpperCase()
  return key === '' ? null : key
}
