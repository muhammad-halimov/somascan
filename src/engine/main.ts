/**
 * Точка входа движка очереди (`upload-engine.js`, сборка `vite.engine.config.ts`).
 *
 * Нативная часть ставит `SomascanHost` и загружает этот файл; движок сразу берётся за очередь
 * и ждёт команд в `SomascanEngine.command(json)` (см. `protocol.ts`).
 */
import './polyfills'
import { UploadError } from '@/features/uploads/UploadError'
import { KeyValueStore } from '@/lib/storage/KeyValueStore'
import { Engine } from './Engine'
import { host, hostStorage, type HostFailure } from './host'
import { HostSmbShare } from './HostSmbShare'
import { hostFetch } from './hostFetch'
import type { EngineCommand } from './protocol'

/** Токен Drive у хоста; отказы — как у плагина `GoogleDriveAuth` в приложении. */
async function googleToken(): Promise<string> {
  try {
    return (await host.call<{ accessToken: string }>('googleToken')).accessToken
  } catch (error) {
    const failure = error as HostFailure
    if (failure.code === 'notConfigured') throw new UploadError('driveNotConfigured', { detail: failure.message })
    if (failure.code === 'notSignedIn' || failure.code === 'authRequired') throw new UploadError('authRequired', { detail: failure.message })
    throw new UploadError('hostUnreachable', { host: 'accounts.google.com', detail: failure.message })
  }
}

const engine = new Engine({
  storage: new KeyValueStore(hostStorage),
  backends: { smb: new HostSmbShare(), google: { accessToken: googleToken }, fetch: hostFetch },
  emit: ({ type, ...payload }) => host.emit(type, payload),
})

;(globalThis as unknown as Record<string, unknown>).SomascanEngine = {
  /** Команда от нативной части (JSON `EngineCommand`). */
  command(json: string) {
    try {
      engine.command(JSON.parse(json) as EngineCommand)
    } catch (error) {
      host.log('error', `bad command: ${error instanceof Error ? error.message : String(error)}`)
    }
  },
}

engine.start()
