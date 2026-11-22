/**
 * Обработчики вызовов окна (`window.api`, см. `preload.ts`). Каналы — `IPC` из `shared/protocol`.
 */
import path from 'node:path'
import { app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { message } from '@/shared/messages'
import { IPC, type ActionName, type BellEvent, type InitData, type OpenTarget } from '@/shared/protocol'
import { DESKS, isOneOf, MAC_VOLUMES, uncPath, WORKPLACES, type FileKind, type SettingsPatch, type Workplace } from '@/shared/settings'
import type { HostServices } from './HostServices'

/** Сколько записей журнала отдавать окну при открытии. */
const INIT_ENTRIES = 300

/** Применяет тему окна. */
export function applyTheme(theme: string): void {
  nativeTheme.themeSource = theme === 'light' || theme === 'dark' ? theme : 'system'
}

/** Регистрирует обработчики. */
export function registerIpc(h: HostServices): void {
  const { settings, journal, sync, watcher, links, storage, window, paths, drive, bridge, signatures } = h

  ipcMain.handle(IPC.init, (): InitData => ({
    settings: settings.publicSettings(),
    run: sync.getSnapshot(),
    journal: journal.entries.slice(-INIT_ENTRIES),
    version: app.getVersion(),
    year: new Date().getFullYear(),
    platform: process.platform,
    documents: app.getPath('documents'),
  }))

  ipcMain.handle(IPC.setSettings, (_e, patch: SettingsPatch) => {
    const keys = settings.apply(patch)
    const s = settings.getSnapshot()
    if (keys.includes('theme')) applyTheme(s.theme)
    if (keys.includes('openAtLogin')) app.setLoginItemSettings({ openAtLogin: s.openAtLogin })
    if (keys.includes('intervalSec') && watcher.active) watcher.scheduleNext()
    return settings.publicSettings()
  })

  ipcMain.handle(IPC.start, () => watcher.start())
  ipcMain.handle(IPC.stop, () => watcher.stop())

  ipcMain.handle(IPC.pick, async (_e, kind: FileKind, current?: string) => {
    const s = settings.getSnapshot()
    const f = settings.files()
    // таблица лаборатории или контроля качества — со своим местом хранения, рядом с таблицами цеха её не ищем
    const desk = isOneOf(DESKS)(kind) ? kind : null
    const cur = current || (desk ? '' : (kind === 'sarjele' || kind === 'probe' ? f[kind] : '') || settings.consumFiles()[0] || f.sarjele) || ''
    // сетевой диск: куда он подключён, иначе общая папка (без неё — сервер: в окне выбора видны его папки)
    const smbDir = storage.smb.mountPoint ?? (process.platform === 'win32' ? (s.smb.host ? uncPath(s.smb) : '') : MAC_VOLUMES)
    const target = desk ? s.desks[desk].target : s.target
    const startDir = cur ? path.dirname(cur) : target === 'smb' && smbDir ? smbDir : app.getPath('documents')
    const options = { properties: ['openFile' as const], defaultPath: startDir, filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm'] }] }
    const r = window.win ? await dialog.showOpenDialog(window.win, options) : await dialog.showOpenDialog(options)
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  ipcMain.handle(IPC.check, (_e, kind: FileKind, file?: string) => storage.check(kind, file))

  ipcMain.handle(IPC.action, (_e, name: ActionName) => {
    const { workplace } = settings.getSnapshot()
    const migrate = name === 'migrate-plan' || name === 'migrate-write'
    if (workplace === 'laborator' && migrate) return sync.migrateLaborator(name === 'migrate-write')
    // лаборатория таблицу только читает: разовый прогон — чтение последней записи
    if (workplace === 'laborator' && name === 'plan') return sync.readLaborator('plan')
    // у контроля качества прогонов пока нет — таблицы цеха не трогаем
    if (workplace !== 'atelier') {
      const error = message('event.noRun')
      journal.event('warn', error)
      return { ok: false, error }
    }
    if (name === 'plan') return sync.syncOnce({ apply: false, trigger: 'plan' })
    if (name === 'write') return sync.syncOnce({ apply: true, trigger: 'write' })
    if (name === 'migrate-plan') return sync.syncOnce({ apply: false, migrate: true, trigger: 'migratePlan' })
    return sync.syncOnce({ apply: true, migrate: true, trigger: 'migrateWrite' })
  })

  ipcMain.handle(IPC.backups, () => sync.backups())
  ipcMain.handle(IPC.scan, () => links.scan())
  ipcMain.handle(IPC.setLink, (_e, key: string, value: string | null) => links.set(key, value))
  ipcMain.handle(IPC.createSheets, () => sync.createSheets())

  ipcMain.handle(IPC.restore, async (_e, stamp: string) => {
    const r = await sync.restore(stamp)
    await watcher.resnapshot()
    return r
  })

  ipcMain.handle(IPC.confirm, async (_e, { title, message: text, ok, cancel }: { title: string; message: string; ok?: string; cancel?: string }) => {
    const buttons = [ok || settings.text(message('tray.ok')), cancel || settings.text(message('tray.cancel'))]
    const options = { type: 'warning' as const, buttons, defaultId: 1, cancelId: 1, title, message: text }
    const r = window.win ? await dialog.showMessageBox(window.win, options) : await dialog.showMessageBox(options)
    return r.response === 0
  })

  ipcMain.handle(IPC.mountSmb, () => storage.mount())
  ipcMain.handle(IPC.smbStatus, () => storage.smb.status())
  ipcMain.handle(IPC.signature, (_e, place: Workplace) => (isOneOf(WORKPLACES)(place) ? signatures.preview(place) : null))
  ipcMain.handle(IPC.pickSignature, (_e, place: Workplace) => (isOneOf(WORKPLACES)(place) ? signatures.pick(place, window.win) : null))
  ipcMain.handle(IPC.removeSignature, (_e, place: Workplace) => (isOneOf(WORKPLACES)(place) ? signatures.remove(place) : undefined))

  ipcMain.handle(IPC.smbPassword, () => settings.smbPassword())

  ipcMain.handle(IPC.driveSignIn, () => drive.signIn())
  ipcMain.handle(IPC.driveSignOut, () => drive.signOut())
  ipcMain.handle(IPC.bridgeBell, (_e, event: BellEvent) => bridge.bell(event))

  ipcMain.handle(IPC.clearJournal, () => journal.clear())

  ipcMain.handle(IPC.open, (_e, what: OpenTarget) => {
    if (what === 'log') shell.showItemInFolder(paths.logFile)
    if (what === 'links') {
      links.ensure()
      void shell.openPath(links.file)
    }
  })
}
