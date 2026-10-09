/**
 * Что считается «нажимаемым» элементом с визуальным откликом на касание.
 *
 * Селектор общий для всех платформ: по нему контроллер нажатий (`PressController`) находит
 * элемент под пальцем. Компонент попадает сюда, если у него есть нативный аналог с откликом:
 * вкладка/сегмент, строка списка, кнопка, кнопка-иконка, кнопка внутри поля (глазок, «Сверка»), пустая карточка фото,
 * ячейка сетки фото и значок выбора в ней.
 */
export const PRESSABLE_SELECTOR =
  '.tab, .list-item.is-interactive, .action-button, .button, .input-action, .photo-empty, .photo-grid-open, .photo-grid-select'

/** Точка касания в координатах окна. */
export interface PressPoint {
  x: number
  y: number
}

/** Нажимаемый элемент недоступен: отклика быть не должно. */
export function isDisabledPressable(element: HTMLElement): boolean {
  return element.matches(':disabled, [aria-disabled="true"], [aria-busy="true"]')
}

/**
 * Элемент, внутри которого рисуется отклик. У кнопки-иконки с подписью (`ActionButton`)
 * это круг иконки, а не вся кнопка с подписью; у остальных — сам элемент.
 */
export function resolveFeedbackHost(pressable: HTMLElement): HTMLElement {
  return pressable.querySelector<HTMLElement>(':scope > .action-button-icon') ?? pressable
}
