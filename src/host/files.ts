/**
 * Таблицы из главного процесса — только асинхронно. Таблицы могут лежать на сетевом диске: синхронное обращение
 * к ним останавливало главный процесс, а с ним и окно, пока не ответит сеть (вкладка «Хранилище» зависала
 * на проверке таблиц). Движок работает в отдельном процессе и читает файлы как обычно.
 */
import fs from 'node:fs/promises'
import { Backups, EditorLock, type BackupFile } from '@/engine/FileGuard'

/** «Время:размер» файла или `null`, если файл недоступен. */
export async function fileStamp(file: string): Promise<string | null> {
  try {
    const st = await fs.stat(file)
    return `${st.mtimeMs}:${st.size}`
  } catch {
    return null
  }
}

/** Есть ли файл или папка. */
export async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

/** Открыт ли файл в редакторе: есть ли рядом замок редактора (`EditorLock`). */
export async function openInEditor(file: string): Promise<boolean> {
  return (await Promise.all(EditorLock.candidates(file).map(exists))).includes(true)
}

/** Метки бэкапов таблицы, новые сверху (как `Backups.stamps`: своя папка и общая папка прежних версий). */
export async function backupStamps(table: BackupFile, limit: number): Promise<string[]> {
  const read = (dir: string) => fs.readdir(dir).catch((): string[] => [])
  const [own, legacy] = await Promise.all([read(Backups.dir(table)), read(Backups.legacyDir(table.file))])
  return Backups.stampsOf([...own, ...Backups.legacyOf(table, legacy)], limit)
}

/** Ответ `promise` или `fallback()`, если его нет за `ms` (сетевой диск не отвечает). */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback()), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}
