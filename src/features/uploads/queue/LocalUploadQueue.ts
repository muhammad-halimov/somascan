/**
 * Очередь в браузере: `UploadWorker` прямо на странице, записи — в `localStorage`.
 * Сеть — плагин Network и события `online` / `offline`, пробуждение — возврат приложения на экран.
 */
import { App } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { Network } from '@capacitor/network'
import type { LabelRecord } from '@/features/recognition/label/labelFields'
import { settingsStore } from '@/features/settings/store/SettingsStore'
import { getDeviceId } from '@/lib/platform/deviceId'
import type { UploadStore } from '../store/UploadStore'
import { RetryPolicy } from '../worker/RetryPolicy'
import { TableWriter } from '../worker/TableWriter'
import { UploadWorker, type UploadEnvironment } from '../worker/UploadWorker'
import type { UploadColumn } from '../xlsx/uploadColumns'
import { appBackendDeps } from './appBackends'
import type { UploadQueue } from './UploadQueue'

/** Сеть и пробуждения страницы. */
const pageEnvironment: UploadEnvironment = {
  watch({ online, wake }) {
    let active = true
    const handles: Array<PluginListenerHandle | undefined> = []
    const keep = (promise: Promise<PluginListenerHandle>) => {
      void promise.then((handle) => {
        if (active) handles.push(handle)
        else void handle.remove()
      }).catch(() => undefined)
    }
    void Network.getStatus().then((status) => { if (active) online(status.connected) }).catch(() => undefined)
    keep(Network.addListener('networkStatusChange', (status) => online(status.connected)))
    keep(App.addListener('appStateChange', ({ isActive }) => { if (isActive) wake() }))
    const onOnline = () => online(true)
    const onOffline = () => online(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      active = false
      for (const handle of handles.splice(0)) void handle?.remove()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  },
}

/** Очередь на странице. */
export class LocalUploadQueue implements UploadQueue {
  private readonly store: UploadStore
  private readonly worker: UploadWorker

  /** @param store Очередь записей (сохраняется в `localStorage`). */
  constructor(store: UploadStore) {
    this.store = store
    this.worker = new UploadWorker({
      store,
      settings: { getStorage: () => settingsStore.getSnapshot().storage, subscribe: settingsStore.subscribe },
      writer: new TableWriter(getDeviceId()),
      backends: appBackendDeps,
      retry: new RetryPolicy(),
      environment: pageEnvironment,
    })
  }

  start() {
    this.worker.start()
  }

  enqueue(label: LabelRecord, columns: readonly UploadColumn[]) {
    this.store.enqueue(label, columns)
    this.worker.kick()
  }

  retry(id: string) {
    this.worker.retry(id)
  }

  retryAll() {
    this.worker.retryAll()
  }

  cancel(id: string) {
    this.worker.cancel(id)
  }

  remove(id: string) {
    this.store.remove(id)
  }

  clearCompleted() {
    this.store.clearCompleted()
  }
}
