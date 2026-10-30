/**
 * Обработчики вызовов окна (`window.api`, см. `preload.ts`). Каналы — `IPC` из `shared/protocol`.
 */
import path from 'node:path'
import { app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { message } from '@/shared/messages'
import { IPC, type ActionName, type InitData, type OpenTarget } from '@/shared/protocol'
import type { FileKind, SettingsPatch } from '@/shared/settings'
import type { HostServices } from './HostServices'
import { StorageService } from './StorageService'

/** Сколько записей журнала отдавать окну при открытии. */
const INIT_ENTRIES = 300

/** Применяет тему окна. */
export function applyTheme(theme: string): void {
  nativeTheme.themeSource = theme === 'light' || theme === 'dark' ? theme : 'system'
}

/** Регистрирует обработчики. */
export function registerIpc(h: HostServices): void {
  const { settings, journal, sync, watcher, links, storage, window, paths, drive } = h

  ipcMain.handle(IPC.init, (): InitData => ({
    settings: settings.publicSettings(),
    run: sync.getSnapshot(),
    journal: journal.entries.slice(-INIT_ENTRIES),
    version: app.getVersion(),
    year: new Date().getFullYear(),
    platform: process.platform,
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
    const cur = current || (kind === 'consum' ? '' : f[kind]) || settings.consumFiles()[0] || f.sarjele || ''
    const smbDir = process.platform === 'win32' ? (s.smb.host && s.smb.share ? StorageService.uncPath(s.smb) : '') : '/Volumes'
    const startDir = cur ? path.dirname(cur) : s.target === 'smb' && smbDir ? smbDir : app.getPath('documents')
    const options = { properties: ['openFile' as const], defaultPath: startDir, filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm'] }] }
    const r = window.win ? await dialog.showOpenDialog(window.win, options) : await dialog.showOpenDialog(options)
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  ipcMain.handle(IPC.check, (_e, kind: FileKind, file?: string) => storage.check(kind, file))

  ipcMain.handle(IPC.action, (_e, name: ActionName) => {
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
    watcher.resnapshot()
    return r
  })

  ipcMain.handle(IPC.confirm, async (_e, { title, message: text, ok, cancel }: { title: string; message: string; ok?: string; cancel?: string }) => {
    const buttons = [ok || settings.text(message('tray.ok')), cancel || settings.text(message('tray.cancel'))]
    const options = { type: 'warning' as const, buttons, defaultId: 1, cancelId: 1, title, message: text }
    const r = window.win ? await dialog.showMessageBox(window.win, options) : await dialog.showMessageBox(options)
    return r.response === 0
  })

  ipcMain.handle(IPC.mountSmb, async () => {
    const r = await storage.mount()
    if (r.ok) journal.event('ok', message('event.smbMounted', { mount: r.mount || settings.getSnapshot().smb.share }))
    else if (r.error) journal.event('err', message('event.smbFailed', { error: r.error }))
    return { ok: r.ok, error: r.error }
  })

  ipcMain.handle(IPC.smbPassword, () => settings.smbPassword())

  ipcMain.handle(IPC.driveSignIn, () => drive.signIn())
  ipcMain.handle(IPC.driveSignOut, () => drive.signOut())

  ipcMain.handle(IPC.clearJournal, () => journal.clear())

  ipcMain.handle(IPC.open, (_e, what: OpenTarget) => {
    if (what === 'log') shell.showItemInFolder(paths.logFile)
    if (what === 'links') {
      links.ensure()
      void shell.openPath(links.file)
    }
  })
}
