import type { KeyValueStore } from './KeyValueStore'

/**
 * Один JSON-документ в `KeyValueStore`, проверяемый при каждом чтении.
 *
 * `parse` получает недоверенные данные (старые версии приложения, ручные правки, повреждения)
 * и должен вернуть валидный `T` либо `null`, чтобы отклонить их.
 */
export class StoredValue<T> {
  /** Ключ хранилища. */
  readonly key: string
  /** Хранилище, в котором лежит значение. */
  private readonly storage: KeyValueStore
  /** Превращает разобранный JSON в `T` или отклоняет его, возвращая `null`. */
  private readonly parse: (data: unknown) => T | null

  /**
   * @param storage Где лежит значение.
   * @param key Ключ хранилища; при несовместимом изменении формата увеличивайте суффикс версии.
   * @param parse Валидатор сохранённого JSON.
   */
  constructor(storage: KeyValueStore, key: string, parse: (data: unknown) => T | null) {
    this.storage = storage
    this.key = key
    this.parse = parse
  }

  /** Сохранённое значение или `null`, если его нет, оно не JSON или отклонено `parse`. */
  read(): T | null {
    const raw = this.storage.get(this.key)
    if (raw === null) return null
    try {
      return this.parse(JSON.parse(raw))
    } catch {
      return null
    }
  }

  /** Сериализует и сохраняет `value`. */
  write(value: T) {
    this.storage.set(this.key, JSON.stringify(value))
  }

  /** Удаляет сохранённое значение. */
  clear() {
    this.storage.remove(this.key)
  }
}
