import { useCallback, useState } from 'react'
import { useHistoryLayer } from '@/hooks/useHistoryLayer'

/**
 * Режим правки распознанных полей на весь экран.
 * Системное «Назад» выходит из режима правки, а не из приложения (см. `useHistoryLayer`).
 */
export function useEditMode() {
  const [isEditing, setIsEditing] = useState(false)
  const close = useHistoryLayer(isEditing, () => setIsEditing(false), 'editor')

  /** Входит в режим правки. */
  const enter = useCallback(() => setIsEditing(true), [])

  /** Выходит из режима правки (если он включён). */
  const exit = useCallback(() => {
    if (isEditing) close()
  }, [close, isEditing])

  /** Переключает режим правки. */
  const toggle = useCallback(() => (isEditing ? close() : setIsEditing(true)), [close, isEditing])

  return { isEditing, enter, exit, toggle }
}
