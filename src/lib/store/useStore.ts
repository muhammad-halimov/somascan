import { useSyncExternalStore } from 'react'
import type { Store } from './Store'

/**
 * Подписывает компонент на `Store` и возвращает его текущий снимок.
 * Компонент перерисовывается всякий раз, когда стор заменяет своё состояние.
 */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
