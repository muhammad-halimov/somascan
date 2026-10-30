/**
 * Слушатель «звонка» телефонов в Firebase Firestore (мост с телефонами, `host/PhoneBridge`).
 *
 * Главный процесс решает, что слушать (`bridge.bell` в состоянии прогонов: проект, ключ Web API, канал), окно
 * держит подписку на документ `somascan-bells/<канал>` и сообщает о каждом его изменении (`api.bridgeBell`) —
 * перенос идёт сразу, а не при проверке копии. Слушает окно, а не главный процесс: браузерная сборка Firestore
 * ходит через сеть Chromium (системный прокси, обычный HTTPS), её не нужно класть в программу отдельными модулями.
 * Окно живёт, пока работает программа (закрытие прячет его в трей); в фоне его таймеры не замедляются
 * (`backgroundThrottling: false`).
 */
import type { BellConfig } from '@/shared/protocol'
import { api, runStore } from './state'

/** Коллекция «звонков» (как в мобильном приложении). */
const BELL_COLLECTION = 'somascan-bells'

/** Текущая подписка: ключ (проект, ключ Web API, канал) и отписка. */
let current: { key: string; stop: () => void } | null = null
/** Номер последней смены подписки: подписка, которую успели сменить, пока грузился Firebase, не ставится. */
let generation = 0
/** Ключ подписки, которая сейчас ставится (Firebase грузится). */
let pending = ''

/** Подписывается на канал (или отписывается, если слушать нечего). Firebase грузится только когда нужен. */
async function follow(bell: BellConfig | null): Promise<void> {
  const key = bell ? `${bell.projectId}|${bell.apiKey}|${bell.channel}` : ''
  if (pending ? pending === key : (current?.key ?? '') === key) return
  const mine = ++generation
  current?.stop()
  current = null
  pending = key
  if (!bell) {
    pending = ''
    return
  }
  try {
    const [{ deleteApp, initializeApp }, { doc, getFirestore, onSnapshot }] = await Promise.all([import('firebase/app'), import('firebase/firestore')])
    if (mine !== generation) return
    pending = ''
    const app = initializeApp({ projectId: bell.projectId, apiKey: bell.apiKey }, `bell-${mine}`)
    let first = true
    const unsubscribe = onSnapshot(
      doc(getFirestore(app), BELL_COLLECTION, bell.channel),
      (snapshot) => {
        // первый снимок — состояние на момент подписки, а не звонок
        if (first) {
          first = false
          void api.bridgeBell({ error: null })
          return
        }
        if (!snapshot.metadata.hasPendingWrites) void api.bridgeBell({ ring: true })
      },
      (error) => void api.bridgeBell({ error: error.code || error.message }),
    )
    current = { key, stop: () => {
      unsubscribe()
      void deleteApp(app)
    } }
  } catch (error) {
    if (mine !== generation) return
    pending = ''
    void api.bridgeBell({ error: error instanceof Error ? error.message : String(error) })
  }
}

/** Следит за `bridge.bell` в состоянии прогонов. Вызывается один раз после загрузки состояния. */
export function startBellListener(): void {
  void follow(runStore.getSnapshot().bridge.bell)
  runStore.subscribe(() => void follow(runStore.getSnapshot().bridge.bell))
}
