/**
 * Очередь этого устройства к общему серверу LM Studio (`ModelUseGate`) с отметками в хранилище таблицы
 * по текущим настройкам «Хранилище». Ею пользуются распознавание (`workspace/utils/recognizeLabel`)
 * и смена модели в настройках (`LocalModelLoader`).
 */
import { ModelUseGate, type LeaseBoard } from '@/features/recognition/catalog/ModelUseGate'
import type { StorageSettings } from '@/features/settings/store/settingsSchema'
import { settingsStore } from '@/features/settings/store/SettingsStore'
import { getDeviceId } from '@/lib/platform/deviceId'
import { appBackendDeps } from '../queue/appBackends'
import { leaseBoardFor } from './storageLeaseBoards'

/** Папка отметок для последних настроек хранилища (у Drive она помнит id своего файла). */
let cached: { storage: StorageSettings; board: LeaseBoard | null } | null = null

/** Очередь к LM Studio этого устройства. */
export const lmStudioGate = new ModelUseGate({
  device: getDeviceId(),
  board: () => {
    const { storage } = settingsStore.getSnapshot()
    if (cached?.storage !== storage) cached = { storage, board: leaseBoardFor(storage, appBackendDeps) }
    return cached.board
  },
})
