/**
 * Слежение за Consum: раз в `intervalSec` секунд сравнивает время изменения и размер каждого Consum.
 *
 * Изменился — пауза `settleSec` (редактор дописывает файл), затем прогон по этому Consum.
 * Отложенная запись (`pending`: файл был открыт в редакторе) повторяется, когда замки редакторов исчезнут.
 * «Слежение включено» хранится в настройках (`running`): после перезапуска программа продолжает с того же места.
 *
 * Consum в Google Drive: перед каждой проверкой изменившийся на Drive Consum скачивается в локальную копию
 * (`remote.refreshConsums`), и проверка видит изменение копии.
 *
 * В конце каждой проверки — мост с телефонами (`bridge`, см. `PhoneBridge`): в том же цикле, чтобы его прогон
 * не совпал с прогоном по Consum.
 *
 * РИСК: на медленном сетевом диске `settleSec` может не хватить — движок прочтёт недописанный Consum.
 * Прогон запускают только изменения Consum: правки Sarjele или Probe сами прогон не запускают.
 */
import fs from 'node:fs'
import path from 'node:path'
import { EditorLock } from '@/engine/FileGuard'
import { message } from '@/shared/messages'
import type { ActionResult } from '@/shared/protocol'
import type { Journal } from './Journal'
import type { SettingsStore } from './SettingsStore'
import type { SyncService } from './SyncService'

/** Слежение за Consum в удалённом хранилище (Google Drive). */
export interface RemoteConsums {
  active(): boolean
  /** Скачивает Consum, изменившиеся на удалённом хранилище. */
  refreshConsums(): Promise<void>
}

/** Мост с телефонами: своя проверка в цикле слежения. */
export interface BridgeTick {
  tick(): Promise<void>
}

/** Пауза. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** «время:размер» файла или `null`, если файл недоступен. */
function snapOf(file: string): string | null {
  try {
    const s = fs.statSync(file)
    return `${s.mtimeMs}:${s.size}`
  } catch {
    return null
  }
}

/** Слежение за Consum. */
export class ConsumWatcher {
  private readonly settings: SettingsStore
  private readonly journal: Journal
  private readonly sync: SyncService
  private timer: ReturnType<typeof setTimeout> | null = null
  /** Слежение идёт. */
  private watching = false
  /** Последний снимок: файл → «время:размер». */
  private lastSnap: Record<string, string | null> = {}
  /** Consum в удалённом хранилище (задаёт `HostServices`). */
  remote: RemoteConsums | null = null
  /** Мост с телефонами (задаёт `HostServices`). */
  bridge: BridgeTick | null = null
  /** Идёт проверка. */
  private ticking = false
  /** Просили проверить сейчас, пока шла проверка: следующая — сразу после неё. */
  private wakeRequested = false

  constructor(settings: SettingsStore, journal: Journal, sync: SyncService) {
    this.settings = settings
    this.journal = journal
    this.sync = sync
  }

  /** Идёт ли слежение. */
  get active(): boolean {
    return this.watching
  }

  /** Запоминает текущее состояние файлов (после отката, чтобы он не считался изменением). */
  resnapshot(): void {
    this.lastSnap = this.snapAll()
  }

  /** Включает слежение. */
  async start(): Promise<ActionResult> {
    if (this.watching) return { ok: true }
    const bad = await this.sync.readyToRead()
    if (bad) {
      this.journal.event('err', bad)
      this.settings.update({ running: false })
      return { ok: false, error: bad }
    }
    const s = this.settings.getSnapshot()
    this.watching = true
    this.settings.update({ running: true })
    this.sync.patch({ status: 'watching', nextCheckAt: null })
    this.journal.event('info', message(s.write ? 'event.watchWrite' : 'event.watchDry', { seconds: s.intervalSec }))
    this.lastSnap = this.snapAll()
    await this.sync.syncOnce({ apply: s.write, trigger: 'first' })
    if (this.watching) this.scheduleNext()
    else this.finishStop() // «Стоп» нажали во время первого прогона
    return { ok: true }
  }

  /**
   * Проверка сейчас, не дожидаясь таймера («звонок» телефона через Firestore). Идёт проверка — следующая сразу
   * после неё.
   */
  wake(): void {
    if (!this.watching) return
    if (this.ticking) {
      this.wakeRequested = true
      return
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick(), 0)
  }

  /** Планирует следующую проверку. */
  scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer)
    if (!this.watching) return
    const ms = this.wakeRequested ? 0 : Math.max(2, this.settings.getSnapshot().intervalSec) * 1000
    this.wakeRequested = false
    this.sync.patch({ nextCheckAt: Date.now() + ms })
    this.timer = setTimeout(() => void this.tick(), ms)
  }

  /** Выключает слежение. `persist: false` — при выходе из программы (воля «включено» сохраняется). */
  stop({ persist = true }: { persist?: boolean } = {}): void {
    if (persist) this.settings.update({ running: false })
    if (!this.watching) {
      this.sync.patch({ status: 'idle' })
      return
    }
    this.watching = false
    if (this.timer) clearTimeout(this.timer)
    this.sync.patch({ nextCheckAt: null })
    if (this.sync.getSnapshot().busy) {
      this.sync.patch({ status: 'stopping' })
      this.journal.event('info', message('event.stopping'))
    } else this.finishStop()
  }

  /** Немедленно прекращает проверки (выход из программы). */
  halt(): void {
    this.watching = false
    if (this.timer) clearTimeout(this.timer)
  }

  /** Снимок всех Consum. */
  private snapAll(): Record<string, string | null> {
    return Object.fromEntries(this.settings.consumFiles().map((f) => [f, snapOf(f)]))
  }

  /** Одна проверка. */
  private async tick(): Promise<void> {
    if (!this.watching || this.ticking) return
    this.ticking = true
    try {
      await this.check()
    } finally {
      this.ticking = false
    }
    if (this.watching) this.scheduleNext()
    else this.finishStop()
  }

  /** Сравнивает Consum со снимком, запускает прогоны, затем мост с телефонами. */
  private async check(): Promise<void> {
    this.sync.patch({ lastCheckAt: Date.now() })
    if (this.remote?.active() && !this.sync.getSnapshot().busy) await this.remote.refreshConsums()
    if (!this.watching) return
    const cur = this.snapAll()
    const changed: string[] = []
    for (const [f, v] of Object.entries(cur)) {
      const file = path.basename(f)
      const prev = this.lastSnap[f]
      if (v === null) {
        if (prev !== null && prev !== undefined) this.journal.event('warn', message('event.fileGone', { file }))
        this.lastSnap[f] = null
      } else if (v !== prev && v === this.sync.ownWrites.get(f)) {
        // программа сама записала ID в этот Consum — это не изменение от оператора
        this.lastSnap[f] = v
        this.sync.ownWrites.delete(f)
      } else if (v !== prev) {
        if (prev === null) this.journal.event('info', message('event.fileBack', { file }))
        changed.push(f)
      }
    }
    const write = () => this.settings.getSnapshot().write
    if (changed.length) {
      await sleep(this.settings.getSnapshot().settleSec * 1000)
      Object.assign(this.lastSnap, this.snapAll())
      if (this.watching) await this.sync.syncOnce({ apply: write(), trigger: 'changed', only: changed })
    }
    const pending = this.sync.getSnapshot().pending.filter((f) => !changed.includes(f))
    if (this.watching && pending.length && write() && this.editorsClosed(pending)) {
      await this.sync.syncOnce({ apply: true, trigger: 'retry', only: pending })
    }
    if (this.watching && this.bridge) await this.bridge.tick()
  }

  /** Закрыты ли Sarjele, Probe и эти Consum во всех редакторах. */
  private editorsClosed(consums: readonly string[]): boolean {
    const f = this.settings.files()
    return [f.sarjele, f.probe, ...consums].every((x) => !x || !EditorLock.find(x))
  }

  /** Завершение остановки (после прогона, который шёл в момент «Стоп»). */
  private finishStop(): void {
    if (this.watching) return
    this.sync.patch({ status: 'idle', nextCheckAt: null })
    this.journal.event('info', message('event.watchStopped'))
  }
}
