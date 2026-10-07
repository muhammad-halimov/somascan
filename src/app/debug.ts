/**
 * Отладочные ручки для сборки разработки: сторы, каталог моделей, распознавание и очередь выгрузки доступны из консоли
 * отладчика (Chrome DevTools для Android, Safari для iOS) как `window.__somascan`.
 * В production-сборке не вызывается.
 */
import { modelCatalog } from '@/features/recognition/catalog/ModelCatalog'
import { labelRecognizer } from '@/features/recognition/LabelRecognizer'
import { settingsStore } from '@/features/settings/store/SettingsStore'
import { uploadStore } from '@/features/uploads/store/UploadStore'
import { uploadWorker } from '@/features/uploads/worker/UploadWorker'

/** Кладёт сторы в `window.__somascan`. */
export function exposeDebugHandles() {
  Object.assign(window, { __somascan: { settingsStore, uploadStore, uploadWorker, modelCatalog, labelRecognizer } })
}
