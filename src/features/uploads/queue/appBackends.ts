/**
 * Доступ к хранилищам из экрана приложения: плагины Capacitor (`SmbShare`, `GoogleDriveAuth`)
 * и `fetch` WebView. Нужен проверке таблицы во вкладке «Хранилище» и очереди в браузере;
 * на iOS и Android очередь пишет движок со своим нативным доступом (`src/engine`).
 */
import type { StorageSettings } from '@/features/settings/store/settingsSchema'
import { googleDriveSession } from '../drive/GoogleDriveAuth'
import { SmbShareClient } from '../smb/SmbShare'
import type { TableProbeResult } from '../worker/TableBackend'
import { backendFor, type TableBackendDeps } from '../worker/tableBackends'

/** Хранилища через плагины приложения. */
export const appBackendDeps: TableBackendDeps = { smb: new SmbShareClient(), google: googleDriveSession }

/** Подключается к хранилищу с этими настройками и сообщает, есть ли таблица. */
export async function probeTable(storage: StorageSettings): Promise<TableProbeResult> {
  return (await backendFor(storage, appBackendDeps)).probe()
}
