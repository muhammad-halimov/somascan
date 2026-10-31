import { createContext, useContext } from 'react'

/**
 * Плавная смена высоты окна настроек (`SettingsSheet`) внутри вкладки. Вызывается в обработчике до изменения,
 * от которого меняется высота содержимого (например, «На устройстве» → «ИИ-модели»): окно запоминает свою высоту
 * и после отрисовки плавно переходит к новой — и сдвигается вместе с ней.
 */
export const SheetResizeContext = createContext<() => void>(() => {})

/** Функция «сейчас изменится высота» окна настроек. */
export const useSheetResize = () => useContext(SheetResizeContext)
