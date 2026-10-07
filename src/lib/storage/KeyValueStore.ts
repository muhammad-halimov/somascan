/**
 * Безопасная обёртка над `localStorage`.
 *
 * Хранилища может не быть, или оно может бросать исключения (приватный режим, превышена квота, превью WebView),
 * поэтому каждый доступ защищён, а сбои приводят к «ничего не сохранено» вместо падения.
 */
export class KeyValueStore {
  /** Базовое хранилище или `null`, если на платформе его нет. */
  private readonly backend: Storage | null

  /** @param backend Оборачиваемое хранилище; по умолчанию `window.localStorage`, если доступен. */
  constructor(backend: Storage | null = KeyValueStore.defaultBackend()) {
    this.backend = backend
  }

  /** Возвращает `localStorage` или `null`, если его чтение бросает исключение или его не существует. */
  private static defaultBackend(): Storage | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage
    } catch {
      return null
    }
  }

  /** Сырая строка, сохранённая под `key`, или `null`. */
  get(key: string): string | null {
    try {
      return this.backend?.getItem(key) ?? null
    } catch {
      return null
    }
  }

  /** Сохраняет `value` под `key`; при сбое хранилища молча пропускает сохранение. */
  set(key: string, value: string) {
    try {
      this.backend?.setItem(key, value)
    } catch {
      // Ошибка квоты или доступа: состояние в памяти остаётся верным, теряется только сохранение.
    }
  }

  /** Удаляет `key`; ничего не делает, если хранилище недоступно. */
  remove(key: string) {
    try {
      this.backend?.removeItem(key)
    } catch {
      // Чистить нечего, если хранилище недоступно.
    }
  }
}

/** Общий экземпляр для всех сохраняемых сторов приложения. */
export const appStorage = new KeyValueStore()
