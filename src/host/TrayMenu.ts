/**
 * Значок в трее (в строке меню на macOS): состояние, «Старт / Стоп», режим записи, последние записи журнала.
 * Тексты — на языке интерфейса. Меню перестраивается не чаще раза в 250 мс.
 */
import path from 'node:path'
import { app, Menu, nativeImage, shell, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import { message, runHeadline, triggerMessage, type MessageCode } from '@/shared/messages'
import type { JournalEntry } from '@/shared/protocol'
import { LOCALES } from '@/shared/settings'
import type { AppPaths } from './AppPaths'
import type { Journal } from './Journal'
import type { MainWindow } from './MainWindow'
import type { SettingsStore } from './SettingsStore'
import type { SyncService } from './SyncService'

/** Сколько записей журнала показывать в меню. */
const RECENT_ENTRIES = 6
/** Длина строки журнала в меню. */
const LINE_CHARS = 56

/** Что умеет меню. */
export interface TrayActions {
  start(): void
  stop(): void
}

/** Значок и меню трея. */
export class TrayMenu {
  private readonly paths: AppPaths
  private readonly settings: SettingsStore
  private readonly sync: SyncService
  private readonly journal: Journal
  private readonly window: MainWindow
  private readonly actions: TrayActions
  private tray: Tray | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(paths: AppPaths, settings: SettingsStore, sync: SyncService, journal: Journal, window: MainWindow, actions: TrayActions) {
    this.paths = paths
    this.settings = settings
    this.sync = sync
    this.journal = journal
    this.window = window
    this.actions = actions
  }

  /** Есть ли значок. */
  get exists(): boolean {
    return this.tray !== null
  }

  /** Создаёт значок. @returns Ошибка или `null`. */
  create(): string | null {
    try {
      this.tray = new Tray(this.icon())
    } catch (e) {
      this.tray = null
      return (e as Error).message
    }
    this.tray.setContextMenu(this.build())
    this.tray.setToolTip('Somasync')
    // Windows/Linux: щелчок по значку показывает / прячет окно; на macOS щелчок открывает меню
    this.tray.on('click', () => {
      if (process.platform === 'darwin') return
      if (this.window.focused) this.window.hide()
      else this.window.show()
    })
    this.refresh()
    return null
  }

  /** Перестраивает меню (с задержкой). */
  refresh(): void {
    if (!this.tray) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (!this.tray) return
      this.tray.setContextMenu(this.build())
      this.tray.setToolTip(`Somasync — ${this.statusText()}`)
    }, 250)
  }

  /** Убирает значок. */
  destroy(): void {
    try {
      this.tray?.destroy()
    } catch {
      // уже убран
    }
    this.tray = null
  }

  /** Текст по коду `tray.*`. */
  private t(key: string, params?: Record<string, string>): string {
    return this.settings.text(message(`tray.${key}` as MessageCode, params))
  }

  /** Значок: шаблон для строки меню macOS, цветной 16/22 px для Windows/Linux. */
  private icon(): NativeImage {
    if (process.platform === 'darwin') {
      const img = nativeImage.createFromPath(path.join(this.paths.assets, 'trayTemplate.png'))
      img.setTemplateImage(true)
      return img
    }
    const size = process.platform === 'win32' ? 16 : 22
    return nativeImage.createFromPath(path.join(this.paths.assets, 'tray@2x.png')).resize({ width: size, height: size })
  }

  /** Строка состояния. */
  private statusText(): string {
    const run = this.sync.getSnapshot()
    if (run.status === 'stopping') return this.t('stopping')
    if (run.busy) return this.t('busy', { what: this.settings.text(triggerMessage(run.busy)) })
    if (run.status === 'watching') return this.t(this.settings.getSnapshot().write ? 'watchingWrite' : 'watchingDry')
    return this.t('idle')
  }

  /** Запись журнала одной строкой. */
  private entryText(e: JournalEntry): string {
    const text = this.settings.text(e.kind === 'event' ? e.msg : runHeadline(e)) + (e.kind === 'run' && e.file ? ` · ${e.file}` : '')
    const x = text.replace(/\s+/g, ' ').trim()
    return x.length > LINE_CHARS ? x.slice(0, LINE_CHARS - 1) + '…' : x
  }

  /** Меню. */
  private build(): Menu {
    const run = this.sync.getSnapshot()
    const on = run.status === 'watching'
    const stopping = run.status === 'stopping'
    const locale = LOCALES[this.settings.getSnapshot().language]
    const recent = this.journal.entries.slice(-RECENT_ENTRIES).reverse()
    const hhmm = (t: number) => new Date(t).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const template: MenuItemConstructorOptions[] = [
      { label: 'Somasync', enabled: false },
      { label: this.statusText(), enabled: false },
      ...(run.pending.length ? [{ label: this.t('pending', { files: run.pending.map((f) => path.basename(f)).join(', ') }), enabled: false }] : []),
      { type: 'separator' },
      { label: on || stopping ? this.t('stop') : this.t('start'), enabled: !stopping, click: () => (on ? this.actions.stop() : this.actions.start()) },
      { label: this.t('write'), type: 'checkbox', checked: this.settings.getSnapshot().write, enabled: !on && !stopping, click: (item) => this.settings.update({ write: item.checked }) },
      { type: 'separator' },
      { label: this.t('journal'), enabled: false },
      ...(recent.length ? recent.map((e) => ({ label: `${hhmm(e.t)}  ${this.entryText(e)}`, enabled: false })) : [{ label: this.t('empty'), enabled: false }]),
      { label: this.t('openJournal'), click: () => this.window.show('home') },
      { label: this.t('logFile'), click: () => shell.showItemInFolder(this.paths.logFile) },
      { type: 'separator' },
      { label: this.t('show'), click: () => this.window.show() },
      { type: 'separator' },
      { label: this.t('quit'), click: () => app.quit() },
    ]
    return Menu.buildFromTemplate(template)
  }
}
