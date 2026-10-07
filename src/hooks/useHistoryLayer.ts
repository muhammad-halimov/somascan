import { useCallback, useEffect, useRef } from 'react'
import { useBackHandler } from './useBackHandler'

/** Ключ в `history.state`, по которому слой узнаёт свою запись. */
const LAYER_KEY = 'somascanLayer'

/** Id слоя, чья запись сейчас верхняя в истории. */
const currentLayer = () => (window.history.state as Record<string, unknown> | null)?.[LAYER_KEY]

/**
 * Полноэкранный «слой» поверх экрана (режим правки, просмотр фото), который закрывается
 * системным «Назад»: жестом iOS, кнопкой браузера или аппаратной кнопкой Android.
 *
 * Пока слой открыт, в истории лежит его запись. «Назад» снимает её, и слой закрывается.
 * Слои вкладываются: «Назад» закрывает только верхний.
 *
 * @param active Открыт ли слой.
 * @param onDismiss Закрыть слой (вызывается, когда его запись снята из истории).
 * @param layerId Уникальное имя слоя.
 * @returns Функция для кнопки «закрыть»: снимает запись слоя, что и закрывает его.
 */
export function useHistoryLayer(active: boolean, onDismiss: () => void, layerId: string) {
  // Последний обработчик без перерегистрации эффекта.
  const latest = useRef(onDismiss)
  useEffect(() => {
    latest.current = onDismiss
  })

  useEffect(() => {
    if (!active) return
    window.history.pushState({ [LAYER_KEY]: layerId }, '', window.location.href)
    // Слой закрывается, когда его запись перестала быть текущей (сняли её или верхнюю над ней).
    const onPopState = () => {
      if (currentLayer() !== layerId) latest.current()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [active, layerId])

  /** Снимает запись слоя; если её уже нет (например, слой открыли без истории) — закрывает сразу. */
  const close = useCallback(() => {
    if (currentLayer() === layerId) window.history.back()
    else latest.current()
  }, [layerId])

  useBackHandler(active, close)
  return close
}
