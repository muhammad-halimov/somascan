import { useEffect, useRef } from 'react'
import { backHandlers } from '@/lib/navigation/BackHandlerStack'

/**
 * Заставляет кнопку «Назад» на Android вызывать `handler`, пока `active` равен true.
 * Побеждает последний активированный обработчик (см. `BackHandlerStack`).
 */
export function useBackHandler(active: boolean, handler: () => void) {
  // Держим актуальный колбэк без перерегистрации (она сбила бы порядок в стеке).
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })

  useEffect(() => {
    if (!active) return
    return backHandlers.push(() => latest.current())
  }, [active])
}
