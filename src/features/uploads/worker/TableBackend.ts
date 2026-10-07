/**
 * Хранилище таблицы для `TableWriter`: сетевой диск (SMB) или Google Drive.
 *
 * Писатель не знает, где лежит файл: он берёт блокировку, читает байты, собирает новую книгу
 * и просит хранилище атомарно заменить файл (с резервной копией прежнего), затем перечитывает
 * и сверяет результат. Как именно ставится блокировка и делается копия — дело хранилища.
 */
import type { BackupPolicy } from '../xlsx/BackupPolicy'

/** Через сколько блокировка считается брошенной (устройство выключили посреди записи). */
export const LOCK_STALE_MS = 5 * 60_000

/** Итог проверки подключения. */
export interface TableProbeResult {
  /** Таблица уже существует. */
  exists: boolean
  /** Размер таблицы в байтах. */
  size: number
  /** Когда таблица менялась (мс с начала эпохи). */
  modifiedAt: number
}

/** Одна таблица в одном хранилище. */
export interface TableBackend {
  /** Имя таблицы без расширения и расширение — для имён резервных копий. */
  readonly stem: string
  /** Расширение таблицы, с точкой. */
  readonly extension: string

  /**
   * Ставит блокировку таблицы от имени устройства `owner`.
   * @throws {UploadError} `busy`, если таблицу сейчас пишет другое устройство.
   */
  acquireLock(owner: string): Promise<void>

  /** Снимает блокировку; сбой не критичен (брошенную блокировку снимут по сроку). */
  releaseLock(): Promise<void>

  /** Байты таблицы или `null`, если её ещё нет. Запоминает версию для `replace`. */
  read(): Promise<Uint8Array | null>

  /**
   * Атомарно заменяет таблицу на `bytes` и сверяет переданное (хеш); прежний файл,
   * если он был, сохраняется резервной копией с именем `backupName`.
   * @throws {UploadError} `busy`, если таблицу изменили после `read`; `verifyFailed` при расхождении хеша.
   */
  replace(bytes: Uint8Array, backupName: string | undefined): Promise<void>

  /** Перечитывает записанную таблицу с сервера. */
  readBack(): Promise<Uint8Array>

  /** Удаляет резервные копии этой таблицы, которые `policy` считает просроченными. */
  pruneBackups(policy: BackupPolicy, now: number): Promise<void>

  /** Проверяет доступ и сообщает, есть ли таблица (кнопка «Проверить подключение»). */
  probe(): Promise<TableProbeResult>
}
