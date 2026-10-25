/**
 * Точка входа движка (`dist-engine/sync.mjs`). Главный процесс запускает его как Node (`ELECTRON_RUN_AS_NODE`),
 * параметры — см. `EngineOptions`.
 */
import { parseEngineOptions } from './EngineOptions'
import { SyncEngine } from './SyncEngine'

new SyncEngine(parseEngineOptions(process.argv.slice(2), process.env)).run().then(
  (code) => {
    process.exitCode = code
  },
  (e: unknown) => {
    console.error(e)
    process.exitCode = 1
  },
)
