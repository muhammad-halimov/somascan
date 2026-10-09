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
import { LabelWorkbook } from '../xlsx/LabelWorkbook'

/** Хранилища через плагины приложения. */
export const appBackendDeps: TableBackendDeps = { smb: new SmbShareClient(), google: googleDriveSession }

/** Подключается к хранилищу с этими настройками и сообщает, есть ли таблица. */
export async function probeTable(storage: StorageSettings): Promise<TableProbeResult> {
  return (await backendFor(storage, appBackendDeps)).probe()
}

/**
 * Листы журнала по этим настройкам — для выбора листа (в настройках хранилища и в поле бирки «Лист»).
 * Только чтение, без блокировки; служебный скрытый лист не входит. Таблицы нет — пустой список.
 */
export async function listTableSheets(storage: StorageSettings): Promise<string[]> {
  const bytes = await (await backendFor(storage, appBackendDeps)).read()
  return bytes ? (await LabelWorkbook.open(bytes)).sheetNames : []
}
