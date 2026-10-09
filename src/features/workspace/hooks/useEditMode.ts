import { useCallback, useState } from 'react'
import { flushSync } from 'react-dom'
import { useHistoryLayer } from '@/hooks/useHistoryLayer'
import { prefersReducedMotion } from '../utils/motion'

/**
 * Смена режима правки — с анимацией перехода (View Transitions): карточка результата плавно переезжает
 * и растягивается на новое место, блок фото уезжает, а не перескакивают. Имена переходов карточкам даёт
 * класс `is-edit-transition` (только на время перехода — в покое они ни на что не влияют). Без поддержки
 * (старые WebView) и при «уменьшить движение» режим меняется сразу.
 */
function animateEditMode(update: () => void) {
  if (typeof document.startViewTransition !== 'function' || prefersReducedMotion()) {
    update()
    return
  }
  const root = document.documentElement
  root.classList.add('is-edit-transition')
  const transition = document.startViewTransition(() => flushSync(update))
  void transition.finished.finally(() => root.classList.remove('is-edit-transition'))
}

/**
 * Режим правки распознанных полей на весь экран; вход и выход анимированы (см. `animateEditMode`).
 * Системное «Назад» выходит из режима правки, а не из приложения (см. `useHistoryLayer`).
 */
export function useEditMode() {
  const [isEditing, setIsEditing] = useState(false)
  const close = useHistoryLayer(isEditing, () => animateEditMode(() => setIsEditing(false)), 'editor')

  /** Выходит из режима правки (если он включён). */
  const exit = useCallback(() => {
    if (isEditing) close()
  }, [close, isEditing])

  /** Переключает режим правки. */
  const toggle = useCallback(() => (isEditing ? close() : animateEditMode(() => setIsEditing(true))), [close, isEditing])

  return { isEditing, exit, toggle }
}
