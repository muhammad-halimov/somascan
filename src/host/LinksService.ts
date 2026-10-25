/**
 * Вкладка «Связи»: чтение связей (движок `--scan` по каждому Consum, ничего не пишет) и ручные привязки
 * элементов к блокам — `userData/links.json`:
 *
 *   «ПРОЕКТ|название в Consum» → заголовок блока, `@new` (новый блок) или `@skip` (не обрабатывать)
 *
 * Движок читает links.json при каждом прогоне (`LINKS`, проверка — `engine/planning/ElementLinker` → `LinksFile`).
 * Испорченный файл программа не перезаписывает: правки оператора в нём не теряются, привязка не сохраняется,
 * а в журнале — ошибка с причиной.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { linkKey, LinksFile } from '@/engine/planning/ElementLinker'
import { message, MessageError } from '@/shared/messages'
import type { EngineScan, ScanData, ScanProject } from '@/shared/protocol'
import type { EngineRunner } from './EngineRunner'
import type { Journal } from './Journal'
import type { SettingsStore } from './SettingsStore'
import type { SyncService } from './SyncService'

/** Привязки. */
export type LinksMap = Record<string, string>

/** Связи элементов с блоками и ручные привязки. */
export class LinksService {
  /** Путь к links.json. */
  readonly file: string
  private readonly settings: SettingsStore
  private readonly runner: EngineRunner
  private readonly sync: SyncService
  private readonly journal: Journal
  /** Чтение уже идёт. */
  private scanning = false

  constructor(file: string, settings: SettingsStore, runner: EngineRunner, sync: SyncService, journal: Journal) {
    this.file = file
    this.settings = settings
    this.runner = runner
    this.sync = sync
    this.journal = journal
  }

  /** Ручные привязки (нет файла или он испорчен — пусто). */
  read(): LinksMap {
    try {
      return LinksFile.read(this.file).links
    } catch {
      return {}
    }
  }

  /**
   * Ставит или снимает (`null` / пусто) привязку «ПРОЕКТ|элемент». Остальные строки файла не трогаются;
   * строки того же элемента в другом регистре заменяются. Испорченный файл не перезаписывается.
   * @returns Все привязки.
   */
  set(key: string, value: string | null): LinksMap {
    let links: Record<string, unknown>
    try {
      links = LinksFile.raw(this.file)
    } catch (e) {
      if (!(e instanceof MessageError)) throw e
      this.journal.event('err', e.msg)
      return {}
    }
    const bar = key.indexOf('|')
    const k = linkKey(key.slice(0, bar), key.slice(bar + 1))
    for (const old of Object.keys(links)) {
      const b = old.indexOf('|')
      if (b > 0 && linkKey(old.slice(0, b), old.slice(b + 1)) === k) delete links[old]
    }
    if (value) links[key] = value
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(links, null, 2) + '\n')
    fs.renameSync(`${this.file}.tmp`, this.file)
    return this.read()
  }

  /** Создаёт пустой файл, если его нет (чтобы открыть в редакторе). */
  ensure(): void {
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '{}\n')
  }

  /** Читает файлы и возвращает проекты, листы, элементы и их привязки (результаты всех Consum сливаются). */
  async scan(): Promise<ScanData> {
    const empty: ScanData = { files: [], elements: [], projects: [], sheets: [], orphans: [], registry: 0, links: {} }
    const bad = this.sync.pathsProblem()
    if (bad) return { ...empty, error: bad }
    if (this.scanning) return { ...empty, error: message('scan.busy') }
    this.scanning = true
    try {
      const f = this.settings.files()
      const merged: ScanData = { ...empty }
      const seen = new Map<string, ScanProject>()
      for (const consum of this.settings.consumFiles()) {
        const out = path.join(os.tmpdir(), `somasync-scan-${process.pid}-${Date.now()}-${merged.files.length}.json`)
        const r = await this.runner.run(['--scan', consum, f.sarjele, f.probe], { JSON_OUT: out })
        let j: EngineScan | null = null
        try {
          j = JSON.parse(fs.readFileSync(out, 'utf8')) as EngineScan
          fs.unlinkSync(out)
        } catch {
          // движок упал до записи итога
        }
        if (j?.error) return { ...empty, error: j.error }
        if (r.code !== 0 || !j) return { ...empty, error: message('scan.failed', { file: path.basename(consum), error: r.err.split('\n').filter(Boolean).slice(-2).join(' ') }) }
        merged.files.push(j.source)
        merged.elements.push(...j.elements)
        for (const p of j.projects) {
          const prev = seen.get(p.raw)
          if (prev) {
            prev.rows += p.rows
            prev.sources = [...(prev.sources ?? []), j.source]
          } else seen.set(p.raw, { ...p, sources: [j.source] })
        }
        if (merged.files.length === 1) {
          merged.sheets = j.sheets
          merged.orphans = j.orphans
          merged.registry = j.registry
        }
      }
      merged.projects = [...seen.values()]
      merged.links = this.read()
      return merged
    } finally {
      this.scanning = false
    }
  }
}
