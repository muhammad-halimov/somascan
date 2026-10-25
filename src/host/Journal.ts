/**
 * Журнал программы: события (слежение, файлы, ошибки) и прогоны движка с итогом и техническим выводом.
 *
 * В памяти — последние записи для окна и трея; на диске — `log.txt` (по-русски, построчно, для разбора проблем).
 * Окно получает запись целиком при появлении и при завершении прогона (`subscribe`) и переводит её само.
 */
import fs from 'node:fs'
import { formatRu, runHeadline, type Message } from '@/shared/messages'
import type { JournalEntry, JournalEvent, JournalLevel, JournalRun, RunOutcome, RunSummary, RunTrigger, TechLine } from '@/shared/protocol'

/** Сколько записей держать в памяти. */
const MAX_ENTRIES = 400
/** Сколько строк технического вывода держать у прогона. */
const MAX_RUN_LINES = 4000
/** Размер файла журнала, после которого он обрезается при запуске. */
const MAX_FILE_BYTES = 5e6
/** Сколько оставить от файла при обрезке. */
const KEEP_FILE_CHARS = 1e6

/** Журнал. */
export class Journal {
  /** Последние записи. */
  readonly entries: JournalEntry[] = []
  /** Файл журнала. */
  private readonly file: string
  private readonly listeners = new Set<(entry: JournalEntry) => void>()
  private nextId = 1

  constructor(file: string) {
    this.file = file
  }

  /** Уровень строки технического вывода движка (stdout): по её началу. */
  static classify(line: string): TechLine['level'] {
    if (/ОШИБКА|!!!|Error|Traceback/i.test(line)) return 'err'
    if (/^\s*!|Пропущ|не хватает|НЕТ ОСТАТКА|предупрежд|отложен/i.test(line)) return 'warn'
    if (/^\s*✔|Записан|Восстановлено|Бэкап/.test(line)) return 'ok'
    if (/^\s*■/.test(line)) return 'plan'
    return 'info'
  }

  /** Уровень строки stderr движка: предупреждения (`!`) — внимание, остальное — ошибка. */
  static classifyStderr(line: string): TechLine['level'] {
    return /^\s*!/.test(line) ? 'warn' : 'err'
  }

  /** Обрезает разросшийся файл журнала. */
  trimFile(): void {
    try {
      if (fs.statSync(this.file).size > MAX_FILE_BYTES) fs.writeFileSync(this.file, fs.readFileSync(this.file, 'utf8').slice(-KEEP_FILE_CHARS))
    } catch {
      // файла ещё нет
    }
  }

  /** Событие программы. */
  event(level: JournalLevel, msg: Message): void {
    const entry: JournalEvent = { kind: 'event', id: this.nextId++, t: Date.now(), level, msg }
    this.write(level, formatRu(msg))
    this.push(entry)
  }

  /** Начало прогона. */
  beginRun(trigger: RunTrigger, file: string | null, apply: boolean): JournalRun {
    const run: JournalRun = { kind: 'run', id: this.nextId++, t: Date.now(), trigger, file, apply, outcome: 'running', finishedAt: null, summary: null, lines: [] }
    this.write('head', `── ${formatRu(runHeadline(run))}${file ? ` · ${file}` : ''}${apply ? ' · запись' : ' · только план'}`)
    this.push(run)
    return run
  }

  /** Строка технического вывода прогона (в окно уходит вместе с итогом). */
  runLine(run: JournalRun, level: TechLine['level'], text: string): void {
    if (run.lines.length < MAX_RUN_LINES) run.lines.push({ level, text })
    this.write(level, text)
  }

  /** Конец прогона. */
  finishRun(run: JournalRun, outcome: RunOutcome, summary: RunSummary | null): void {
    run.outcome = outcome
    run.summary = summary
    run.finishedAt = Date.now()
    this.write(outcome === 'failed' ? 'err' : outcome === 'deferred' ? 'warn' : 'ok', formatRu(runHeadline(run)) + (summary?.error ? `: ${formatRu(summary.error)}` : ''))
    this.notify(run)
  }

  /** Очищает записи в памяти (файл остаётся). */
  clear(): void {
    this.entries.length = 0
  }

  /** Подписка на новые и изменённые записи. @returns Отписка. */
  subscribe(listener: (entry: JournalEntry) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private push(entry: JournalEntry): void {
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    this.notify(entry)
  }

  private notify(entry: JournalEntry): void {
    for (const l of this.listeners) l(entry)
  }

  /** Строка в `log.txt`. */
  private write(level: string, text: string): void {
    try {
      fs.appendFileSync(this.file, `${new Date().toISOString()} [${level}] ${text}\n`)
    } catch {
      // журнал на диске — не главное
    }
  }
}
