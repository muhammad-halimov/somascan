/**
 * Службы главного процесса и их связи: кто от кого зависит и кто кому сообщает об изменениях.
 *
 *   SettingsStore  настройки (`state.json`)          → окно, трей
 *   Journal        события и прогоны (`log.txt`)     → окно, трей
 *   SyncService    прогоны движка и их состояние     → окно, трей
 *   ConsumWatcher  слежение за таблицами рабочего места (Consum цеха, таблица лаборатории)
 *   EngineRunner   запуск движка
 *   LinksService   вкладка «Связи»: чтение связей, ручные привязки (`links.json`)
 *   StorageService вкладка «Хранилище»: проверка таблиц, сетевой диск (`SmbShare`, и подключение перед работой)
 *   SignatureService подпись лаборанта: изображение с прозрачным фоном в папке данных
 *   DriveService   Google Drive: вход, скачивание таблиц перед прогоном и выгрузка после
 *   PhoneBridge    мост с телефонами: бирки из копии Probe в Google Drive — в Probe, Probe — на место копии
 *   MainWindow, TrayMenu
 */
import { app, shell } from 'electron'
import { IPC } from '@/shared/protocol'
import { message } from '@/shared/messages'
import { AppPaths } from './AppPaths'
import { ConsumWatcher } from './ConsumWatcher'
import { DriveService } from './drive/DriveService'
import { EngineRunner } from './EngineRunner'
import { Journal } from './Journal'
import { LinksService } from './LinksService'
import { MainWindow } from './MainWindow'
import { PhoneBridge } from './PhoneBridge'
import { SettingsStore } from './SettingsStore'
import { SignatureService } from './SignatureService'
import { StorageService } from './StorageService'
import { SyncService } from './SyncService'
import { TrayMenu } from './TrayMenu'

/** Службы главного процесса. */
export class HostServices {
  readonly paths = new AppPaths()
  readonly journal = new Journal(this.paths.logFile)
  readonly settings = new SettingsStore(
    this.paths.stateFile,
    (error) => this.journal.event('err', message('event.settingsNotSaved', { error })),
    (kind) => this.journal.event('warn', message(kind === 'smb' ? 'event.smbPasswordLocked' : 'event.driveTokenLocked')),
  )
  readonly runner = new EngineRunner(this.paths, this.settings, this.journal)
  readonly sync = new SyncService(this.settings, this.journal, this.runner)
  readonly watcher = new ConsumWatcher(this.settings, this.journal, this.sync)
  readonly links = new LinksService(this.paths.linksFile, this.settings, this.runner, this.sync, this.journal)
  readonly drive = new DriveService(this.paths, this.settings, this.journal, (url) => void shell.openExternal(url), () => this.returnToApp())
  readonly storage = new StorageService(this.settings, this.drive, this.journal)
  readonly signatures = new SignatureService(this.paths, this.settings, this.journal)
  readonly bridge = new PhoneBridge(this.paths, this.settings, this.journal, this.sync, this.drive)
  readonly window = new MainWindow(this.paths, this.settings)
  readonly tray = new TrayMenu(this.paths, this.settings, this.sync, this.journal, this.window, {
    start: () => void this.watcher.start(),
    stop: () => this.watcher.stop(),
  })

  /** Окно — на передний план поверх браузера (после входа в Google): в macOS программу нужно ещё и активировать. */
  private returnToApp(): void {
    this.window.show()
    if (process.platform === 'darwin') app.focus({ steal: true })
  }

  /** Связывает изменения состояния с окном и треем. */
  wire(): void {
    this.journal.language = () => this.settings.getSnapshot().language
    this.settings.resolveDrive = (folder, names) => this.drive.mirror.resolve(folder, names)
    this.sync.remote = this.drive
    this.sync.share = this.storage
    this.watcher.remote = this.drive
    this.watcher.bridge = this.bridge
    this.bridge.wake = () => this.watcher.wake()
    this.window.hasTray = () => this.tray.exists
    this.window.onVisibilityChange = () => this.tray.refresh()
    this.window.onProblem = (m) => this.journal.event('err', m)
    this.settings.subscribe(() => {
      this.window.send(IPC.settings, this.settings.publicSettings())
      this.tray.refresh()
      this.bridge.refreshBell()
    })
    this.sync.subscribe(() => {
      this.bridge.refreshBell()
      this.window.send(IPC.run, this.sync.getSnapshot())
      this.tray.refresh()
    })
    this.journal.subscribe((entry) => {
      this.window.send(IPC.journal, entry)
      this.tray.refresh()
    })
    this.bridge.refreshBell()
  }
}
