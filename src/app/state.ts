/**
 * Состояние окна: мост к главному процессу (`window.api`) и копии его данных — настройки, прогоны, журнал,
 * сведения о программе. Главный процесс присылает изменения сам (`on*`), окно только отображает.
 */
import { useSyncExternalStore } from 'react'
import { Store } from '@/shared/Store'
import type { Api, JournalEntry, RunState } from '@/shared/protocol'
import { DEFAULT_SETTINGS, mergeSettings, type AppSettings, type SettingsPatch } from '@/shared/settings'
import { setLanguage } from './i18n'

declare global {
  interface Window {
    /** API главного процесса (`host/preload.ts`). */
    api: Api
  }
}

/** API главного процесса. */
export const api: Api = window.api

/** Подписывает компонент на стор; перерисовка — при каждой замене состояния. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

/**
 * Настройки: изменение применяется сразу в окне (поля не «прыгают» при вводе) и уходит в главный процесс,
 * который сохраняет его и присылает итог обратно. Язык интерфейса переключается вместе с настройкой.
 */
class SettingsStore extends Store<AppSettings> {
  constructor() {
    super(DEFAULT_SETTINGS)
  }

  hydrate(settings: AppSettings): void {
    this.setState(settings)
  }

  update(patch: SettingsPatch): void {
    this.setState((s) => mergeSettings(s, patch))
    void api.setSettings(patch)
  }

  protected override onChange(state: AppSettings): void {
    setLanguage(state.language)
  }
}

/** Состояние слежения и прогонов. */
class RunStore extends Store<RunState> {
  constructor() {
    super({ status: 'idle', busy: null, nextCheckAt: null, lastCheckAt: null, lastRunAt: null, pending: [], bridge: { syncedAt: null, waiting: false, problem: null, bell: null, bellError: null } })
  }

  hydrate(run: RunState): void {
    this.setState(run)
  }
}

/** Сведения о программе. */
export interface AppInfo {
  version: string
  year: number
  /** Платформа (`darwin`, `win32`, `linux`). */
  platform: string
}

/** Сведения о программе. */
class AppInfoStore extends Store<AppInfo> {
  constructor() {
    super({ version: '', year: new Date().getFullYear(), platform: 'darwin' })
  }

  hydrate(info: AppInfo): void {
    this.setState(info)
  }
}

/** Сколько записей журнала держать в окне. */
const MAX_ENTRIES = 400

/** Журнал: записи приходят новыми и обновлёнными (прогон — при начале и при завершении). */
class JournalStore extends Store<JournalEntry[]> {
  constructor() {
    super([])
  }

  hydrate(entries: JournalEntry[]): void {
    this.setState(entries)
  }

  /** Новая запись или новая версия существующей. */
  upsert(entry: JournalEntry): void {
    this.setState((list) => {
      const i = list.findIndex((e) => e.id === entry.id)
      if (i >= 0) return list.map((e, k) => (k === i ? entry : e))
      return [...list.slice(-(MAX_ENTRIES - 1)), entry]
    })
  }

  /** Очищает журнал (файл журнала остаётся). */
  clear(): void {
    this.setState([])
    void api.clearJournal()
  }
}

export const settingsStore = new SettingsStore()
export const runStore = new RunStore()
export const appInfoStore = new AppInfoStore()
export const journalStore = new JournalStore()

/** Настройки (компонент перерисовывается при их изменении). */
export const useSettings = (): AppSettings => useStore(settingsStore)

/** Загружает состояние и подписывается на изменения. Вызывается один раз до первого рендера. */
export async function startSession(): Promise<void> {
  const d = await api.init()
  settingsStore.hydrate(d.settings)
  runStore.hydrate(d.run)
  journalStore.hydrate(d.journal)
  appInfoStore.hydrate({ version: d.version, year: d.year, platform: d.platform })
  // отступ заголовка под кнопки окна macOS — только на macOS (см. App.css)
  document.documentElement.dataset.platform = d.platform
  api.onSettings((s) => settingsStore.hydrate(s))
  api.onRun((r) => runStore.hydrate(r))
  api.onJournal((e) => journalStore.upsert(e))
}
