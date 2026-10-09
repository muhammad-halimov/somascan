/**
 * Очередь выгрузки приложения: записи для экрана (`uploadStore`) и команды (`uploadQueue`).
 * На iOS и Android записи пишет движок вне WebView, в браузере — страница (см. `UploadQueue.ts`).
 */
import { Capacitor } from '@capacitor/core'
import { appStorage, KeyValueStore } from '@/lib/storage/KeyValueStore'
import { UploadStore } from '../store/UploadStore'
import { LocalUploadQueue } from './LocalUploadQueue'
import { NativeUploadQueue } from './NativeUploadQueue'
import type { UploadQueue } from './UploadQueue'

/** Записи на устройстве пишет движок: экран держит только зеркало его очереди. */
const native = Capacitor.isNativePlatform()

/** Очередь и история записей для экрана. */
export const uploadStore = new UploadStore(native ? new KeyValueStore(null) : appStorage)

/** Команды очереди. */
export const uploadQueue: UploadQueue = native ? new NativeUploadQueue(uploadStore) : new LocalUploadQueue(uploadStore)
