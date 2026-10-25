/**
 * Мост окна к главному процессу: `window.api` (типы — `Api` в `shared/protocol`).
 * Окно не получает Node и Electron — только эти вызовы.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type Api } from '@/shared/protocol'

/** Подписка на событие главного процесса. @returns Отписка. */
const on = <T>(channel: string) => (cb: (value: T) => void) => {
  const handler = (_e: IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: Api = {
  init: () => ipcRenderer.invoke(IPC.init),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  start: () => ipcRenderer.invoke(IPC.start),
  stop: () => ipcRenderer.invoke(IPC.stop),
  pick: (kind, current) => ipcRenderer.invoke(IPC.pick, kind, current),
  check: (kind, file) => ipcRenderer.invoke(IPC.check, kind, file),
  scan: () => ipcRenderer.invoke(IPC.scan),
  setLink: (key, value) => ipcRenderer.invoke(IPC.setLink, key, value),
  createSheets: () => ipcRenderer.invoke(IPC.createSheets),
  action: (name) => ipcRenderer.invoke(IPC.action, name),
  backups: () => ipcRenderer.invoke(IPC.backups),
  restore: (stamp) => ipcRenderer.invoke(IPC.restore, stamp),
  confirm: (options) => ipcRenderer.invoke(IPC.confirm, options),
  mountSmb: () => ipcRenderer.invoke(IPC.mountSmb),
  smbPassword: () => ipcRenderer.invoke(IPC.smbPassword),
  clearJournal: () => ipcRenderer.invoke(IPC.clearJournal),
  open: (what) => ipcRenderer.invoke(IPC.open, what),
  onJournal: on(IPC.journal),
  onNavigate: on(IPC.navigate),
  onRun: on(IPC.run),
  onSettings: on(IPC.settings),
}

contextBridge.exposeInMainWorld('api', api)
