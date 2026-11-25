/**
 * Таблицы из главного процесса — только асинхронно. Таблицы могут лежать на сетевом диске: синхронное обращение
 * к ним останавливало главный процесс, а с ним и окно, пока не ответит сеть (вкладка «Хранилище» зависала
 * на проверке таблиц). Движок работает в отдельном процессе и читает файлы как обычно.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { isReportName, latestReport } from '@/engine/betsy/BetsyReport'
import { Backups, EditorLock, type BackupFile } from '@/engine/FileGuard'
import { message, type Message } from '@/shared/messages'

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

/** Последний рапорт Betsy в папке (`latestReport`) — полный путь — или `null`, если рапортов нет. */
async function latestReportIn(dir: string): Promise<string | null> {
  const names = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && isReportName(e.name)).map((e) => e.name)
  const reports = await Promise.all(names.map(async (name) => ({ name, mtimeMs: (await fs.stat(path.join(dir, name)).catch(() => null))?.mtimeMs ?? 0 })))
  const name = latestReport(reports)
  return name ? path.join(dir, name) : null
}

/**
 * Рапорт Betsy по настройке — один для проверки на вкладке «Хранилище» и для «Записи»: выбранный вручную
 * (`manual`) — сам файл, иначе — последний рапорт директории.
 * @returns Рапорт или почему его нет: пути нет, директория вместо рапорта (и наоборот), рапортов нет, не читается.
 */
export async function resolveBetsyReport(source: string, manual: boolean): Promise<{ file: string } | { error: Message }> {
  const st = await fs.stat(source).catch(() => null)
  if (!st) return { error: message('betsy.notFound', { path: source }) }
  if (manual) return st.isDirectory() ? { error: message('check.betsyNotFile') } : { file: source }
  if (!st.isDirectory()) return { error: message('check.betsyNotDir') }
  try {
    const file = await latestReportIn(source)
    return file ? { file } : { error: message('betsy.noReports', { dir: source }) }
  } catch (e) {
    return { error: message('check.unreadable', { error: (e as Error).message }) }
  }
}
