/**
 * Резервные копии таблицы: имя копии и срок хранения.
 *
 * Перед каждой записью прежний файл переименовывается в копию в папке `backups` рядом с таблицей
 * (переименование — одна атомарная операция на сервере, без повторной передачи файла).
 * Копии старше недели удаляются после очередной успешной записи. Удаляются только файлы,
 * имена которых соответствуют нашему шаблону: чужие файлы в папке не трогаются.
 */
import type { SmbEntry } from '../smb/SmbShare'

/** Имя папки резервных копий рядом с таблицей. */
export const BACKUP_FOLDER = 'backups'

/**
 * Сколько дней хранится копия.
 * РИСК: старше недели копий нет — для долгой истории журнала нужна резервная копия самого сервера или Drive.
 */
export const BACKUP_RETENTION_DAYS = 7

/** Миллисекунд в сутках. */
const DAY_MS = 24 * 60 * 60 * 1000

/** Число с ведущими нулями. */
const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/** Экранирует текст для вставки в регулярное выражение. */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Правила именования и хранения копий одной таблицы. */
export class BackupPolicy {
  /** Имя таблицы без расширения. */
  readonly stem: string
  /** Расширение таблицы, с точкой. */
  readonly extension: string
  /** Срок хранения копии в миллисекундах. */
  readonly retentionMs: number
  /** Шаблон имени копии с группами даты и времени. */
  private readonly pattern: RegExp

  /**
   * @param stem Имя таблицы без расширения.
   * @param extension Расширение таблицы, с точкой.
   * @param retentionDays Срок хранения копий в днях.
   */
  constructor(stem: string, extension: string, retentionDays = BACKUP_RETENTION_DAYS) {
    this.stem = stem
    this.extension = extension
    this.retentionMs = retentionDays * DAY_MS
    this.pattern = new RegExp(`^${escapeRegExp(stem)}\\.(\\d{4})-(\\d{2})-(\\d{2})_(\\d{2})-(\\d{2})-(\\d{2})-(\\d{3})${escapeRegExp(extension)}$`)
  }

  /** Имя копии на момент `now`, например `labels.2026-10-07_13-41-05-123.xlsx` (местное время). */
  backupName(now: Date): string {
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`
    return `${this.stem}.${date}_${time}${this.extension}`
  }

  /** Момент создания копии по её имени (мс с начала эпохи) или `null`, если имя не наше. */
  backupTime(name: string): number | null {
    const match = this.pattern.exec(name)
    if (!match) return null
    const [, year, month, day, hours, minutes, seconds, millis] = match.map(Number)
    return new Date(year!, month! - 1, day!, hours!, minutes!, seconds!, millis!).getTime()
  }

  /** Копии, которые пора удалить: наши файлы старше срока хранения. */
  expired(entries: readonly SmbEntry[], now: number): SmbEntry[] {
    return entries.filter((entry) => {
      if (entry.isDirectory) return false
      const created = this.backupTime(entry.name)
      return created !== null && now - created > this.retentionMs
    })
  }
}
