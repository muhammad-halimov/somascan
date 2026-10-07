/**
 * Минимальный наблюдаемый контейнер состояния.
 *
 * Хранит неизменяемый снимок состояния и уведомляет подписчиков, когда он заменяется.
 * Пара `subscribe`/`getSnapshot` соответствует `useSyncExternalStore` из React,
 * поэтому любой компонент читает стор через `useStore` без провайдеров контекста.
 * Подклассы предоставляют доменные методы (`setLanguage`, `add`, `sync`…) и вызывают `setState`.
 */
export abstract class Store<T> {
  /** Текущий снимок; заменяется, но никогда не мутируется. */
  private state: T
  /** Колбэки, зарегистрированные через `subscribe`. */
  private readonly listeners = new Set<() => void>()

  /** @param initialState Первый снимок. */
  protected constructor(initialState: T) {
    this.state = initialState
  }

  /** Текущий снимок. Стрелочная функция, чтобы её можно было передавать без привязки контекста. */
  readonly getSnapshot = (): T => this.state

  /**
   * Регистрирует `listener`, который будет вызываться после каждого изменения состояния.
   * @returns Функция, снимающая регистрацию слушателя.
   */
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Заменяет снимок и уведомляет подписчиков.
   * Принимает новое состояние или функцию, вычисляющую его из текущего; если ссылка не изменилась, ничего не происходит.
   */
  protected setState(next: T | ((current: T) => T)) {
    const state = typeof next === 'function' ? (next as (current: T) => T)(this.state) : next
    if (Object.is(state, this.state)) return
    this.state = state
    this.onChange(state)
    for (const listener of this.listeners) listener()
  }

  /** Хук для подклассов, вызывается после каждого изменения (например, чтобы сохранить новое состояние). */
  protected onChange(_state: T): void {}
}
