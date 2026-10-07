import { useEffect, useState } from 'react'
import type { PluginListenerHandle } from '@capacitor/core'
import { Network } from '@capacitor/network'

/**
 * `true`, пока у устройства нет сетевого соединения.
 * Использует плагин Capacitor Network, а в качестве запасного варианта — события online/offline браузера.
 */
export function useOffline() {
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    let listener: PluginListenerHandle | undefined
    // Вызовы плагина завершаются асинхронно; после очистки результаты игнорируем.
    let active = true
    const update = (connected: boolean) => setIsOffline(!connected)

    void Network.getStatus()
      .then((status) => { if (active) update(status.connected) })
      .catch(() => { if (active) update(navigator.onLine) })
    void Network.addListener('networkStatusChange', (status) => update(status.connected))
      .then((handle) => {
        listener = handle
        if (!active) void handle.remove()
      })
      .catch(() => undefined)

    const onOnline = () => update(true)
    const onOffline = () => update(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    return () => {
      active = false
      void listener?.remove()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return isOffline
}
