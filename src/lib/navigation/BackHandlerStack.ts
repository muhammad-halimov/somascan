/** Колбэк, обрабатывающий действие «назад» (кнопка «Назад» на Android). */
export type BackHandler = () => void

/**
 * Стек обработчиков «назад».
 *
 * Каждый слой, который можно закрыть (модальное окно, поповер, режим правки), пока открыт,
 * кладёт в стек обработчик; кнопка «Назад» вызывает только верхний, поэтому последний открытый слой закрывается первым.
 */
export class BackHandlerStack {
  /** Зарегистрированные обработчики, снизу вверх. */
  private readonly handlers: BackHandler[] = []

  /**
   * Добавляет обработчик наверх.
   * @returns Функция, удаляющая этот обработчик (где бы он ни находился в стеке).
   */
  push(handler: BackHandler) {
    this.handlers.push(handler)
    return () => {
      const index = this.handlers.lastIndexOf(handler)
      if (index !== -1) this.handlers.splice(index, 1)
    }
  }

  /**
   * Запускает верхний обработчик.
   * @returns `false`, когда стек пуст и нужно применить поведение платформы по умолчанию.
   */
  handleBack() {
    const handler = this.handlers.at(-1)
    handler?.()
    return handler !== undefined
  }
}

/** Общий стек приложения. */
export const backHandlers = new BackHandlerStack()
