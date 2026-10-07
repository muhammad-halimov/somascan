/**
 * Рантайм-проверки типов для данных, пришедших извне системы типов:
 * `localStorage`, JSON-ответы, пользовательский ввод.
 */

/** Простой объект (не `null` и не массив). */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Строковое значение. */
export const isString = (value: unknown): value is string => typeof value === 'string'

/** Строит проверку, которая принимает только перечисленные литеральные значения. */
export const isOneOf = <T extends string | number | null>(values: readonly T[]) =>
  (value: unknown): value is T => (values as readonly unknown[]).includes(value)

/**
 * Читает `source[key]`, если оно проходит `guard`, иначе возвращает `fallback`.
 * Нужна, чтобы сливать сохранённые данные с значениями по умолчанию поле за полем, чтобы одно
 * испорченное поле не сбрасывало весь объект.
 */
export function readField<T>(source: unknown, key: string, guard: (value: unknown) => value is T, fallback: T): T {
  if (!isRecord(source)) return fallback
  const value = source[key]
  return guard(value) ? value : fallback
}
