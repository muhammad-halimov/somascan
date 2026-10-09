/**
 * Проверка наличия таблицы («Настройки → Хранилище»: значок сверки в конце поля пути к таблице
 * и «Проверить подключение»).
 *
 * Приложение таблиц не создаёт: если журнала по пути из настроек нет, писать некуда — запись в очереди
 * получает `tableNotFound` и ждёт исправления настроек. Проверка показывает это заранее.
 *
 * Итог хранится вместе с настройками хранилища, для которых он получен: настройки неизменяемы,
 * поэтому любая правка (сервер, папка, путь, аккаунт) даёт новый объект, и прежний итог больше
 * не относится к ним (`resultFor` вернёт `null`). Итог живёт до перезапуска приложения.
 */
import { settingsStore } from '@/features/settings/store/SettingsStore'
import type { StorageSettings } from '@/features/settings/store/settingsSchema'
import { Store } from '@/lib/store/Store'
import { toUploadError, type UploadError } from '../UploadError'
import type { TableProbeResult } from '../worker/TableBackend'
import { probeTable } from '../queue/appBackends'

/** Итог проверки. */
export type TableCheckResult =
  /** Таблица есть. */
  | { kind: 'found'; size: number; modifiedAt: number }
  /** Подключение есть, таблицы нет — запись невозможна. */
  | { kind: 'missing' }
  /** Проверить не удалось: нет сети, неверный пароль, нет общей папки и т. п. */
  | { kind: 'failed'; error: UploadError }

/** Состояние проверки. */
export interface TableCheckState {
  /** Настройки, для которых получен `result` (или идёт проверка); `null` — проверки не было. */
  storage: StorageSettings | null
  /** Проверка идёт. */
  checking: boolean
  /** Итог последней завершённой проверки. */
  result: TableCheckResult | null
}

/** Подключается к хранилищу и сообщает, есть ли таблица. */
export type TableProbe = (storage: StorageSettings) => Promise<TableProbeResult>

/** Последняя проверка таблицы. */
export class TableCheckStore extends Store<TableCheckState> {
  /** Проверка хранилища. */
  private readonly probe: TableProbe

  /** @param probe Проверка хранилища. */
  constructor(probe: TableProbe) {
    super({ storage: null, checking: false, result: null })
    this.probe = probe
  }

  /** Проверяет таблицу по текущим настройкам хранилища; итог — в состоянии и в ответе. */
  async check(): Promise<TableCheckResult> {
    const { storage } = settingsStore.getSnapshot()
    this.setState({ storage, checking: true, result: null })
    let result: TableCheckResult
    try {
      const table = await this.probe(storage)
      result = table.exists ? { kind: 'found', size: table.size, modifiedAt: table.modifiedAt } : { kind: 'missing' }
    } catch (error) {
      result = { kind: 'failed', error: toUploadError(error) }
    }
    // Пока шла проверка, могла начаться другая (по другим настройкам) — её не затираем.
    this.setState((state) => (state.storage === storage ? { storage, checking: false, result } : state))
    return result
  }

  /** Итог проверки этих настроек или `null`, если их не проверяли (или проверка ещё идёт). */
  resultFor(storage: StorageSettings): TableCheckResult | null {
    const state = this.getSnapshot()
    return state.storage === storage ? state.result : null
  }
}

/** Проверка таблицы приложения. */
export const tableCheckStore = new TableCheckStore(probeTable)
