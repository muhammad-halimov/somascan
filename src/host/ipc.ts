/**
 * Обработчики вызовов окна (`window.api`, см. `preload.ts`). Каналы — `IPC` из `shared/protocol`.
 */
import path from 'node:path'
import { app, dialog, ipcMain, nativeTheme, shell, type OpenDialogOptions } from 'electron'
import { message } from '@/shared/messages'
import { IPC, type ActionName, type BellEvent, type InitData, type OpenTarget } from '@/shared/protocol'
import { DESKS, isOneOf, MAC_VOLUMES, uncPath, workplaceTarget, WORKPLACES, type FileKind, type SettingsPatch, type StorageTarget, type Workplace } from '@/shared/settings'
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

  /**
   * Окно выбора файла или папки: начинается в `dir`, иначе — на сетевом диске (куда он подключён, иначе общая
   * папка, без неё — сервер: видны его папки), иначе — в «Документах».
   * @returns Путь или `null` — выбор отменён.
   */
  const choose = async (dir: string, target: StorageTarget, options: OpenDialogOptions): Promise<string | null> => {
    const s = settings.getSnapshot()
    const smbDir = storage.smb.mountPoint ?? (process.platform === 'win32' ? (s.smb.host ? uncPath(s.smb) : '') : MAC_VOLUMES)
    const defaultPath = dir || (target === 'smb' && smbDir) || app.getPath('documents')
    const r = window.win ? await dialog.showOpenDialog(window.win, { ...options, defaultPath }) : await dialog.showOpenDialog({ ...options, defaultPath })
    return r.canceled ? null : r.filePaths[0] ?? null
  }

  ipcMain.handle(IPC.pick, (_e, kind: FileKind, current?: string) => {
    const s = settings.getSnapshot()
    const f = settings.files()
    // таблица лаборатории или контроля качества — со своим местом хранения, рядом с таблицами цеха её не ищем
    const desk = isOneOf(DESKS)(kind) ? kind : null
    const cur = current || (desk ? '' : (kind === 'sarjele' || kind === 'probe' ? f[kind] : '') || settings.consumFiles()[0] || f.sarjele) || ''
    return choose(cur && path.dirname(cur), desk ? s.desks[desk].target : s.target, { properties: ['openFile'], filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm'] }] })
  })

  ipcMain.handle(IPC.check, (_e, kind: FileKind, file?: string) => storage.check(kind, file))

  // рапорты Betsy: директория (последний рапорт в ней) или, вручную, сам рапорт
  ipcMain.handle(IPC.pickBetsy, () => {
    const s = settings.getSnapshot()
    const target = workplaceTarget(s)
    const { manual, dirs, files } = s.betsy
    if (!manual) return choose(dirs[target], target, { properties: ['openDirectory'] })
    return choose(files[target] ? path.dirname(files[target]) : dirs[target], target, { properties: ['openFile'], filters: [{ name: 'Word', extensions: ['docx'] }] })
  })
  ipcMain.handle(IPC.checkBetsy, (_e, source: string, manual: boolean) => storage.checkBetsy(source, manual))
  ipcMain.handle(IPC.writeBetsy, () => sync.writeBetsy())

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
    // macOS не показывает заголовок окна сообщения: там вопрос — крупно, пояснение — под ним
    const body = process.platform === 'darwin' ? { message: title, detail: text } : { message: text }
    const options = { type: 'warning' as const, buttons, defaultId: 1, cancelId: 1, title, ...body }
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
