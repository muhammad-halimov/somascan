/**
 * Типобезопасный `t()`: ключи и пространства имён проверяются по английским ресурсам,
 * поэтому опечатка в ключе перевода — ошибка компиляции.
 */
import 'i18next'
import type { DEFAULT_NAMESPACE, Resources } from './resources'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof DEFAULT_NAMESPACE
    resources: Resources
  }
}
