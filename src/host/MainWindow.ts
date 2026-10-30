/**
 * Окно программы.
 *
 * Размер постоянный: узкий столбец во всю высоту экрана. Растянуть, свернуть и развернуть окно нельзя — только закрыть.
 * Закрытие не останавливает слежение. Со «сворачиванием в трей» окно прячется в трей на любой платформе;
 * без него на macOS окно тоже просто прячется (выход — Cmd+Q), а в Windows/Linux закрытие завершает программу.
 */
import { app, BrowserWindow, screen, shell } from 'electron'
import { message, type Message } from '@/shared/messages'
import { IPC, type TabId } from '@/shared/protocol'
import type { AppPaths } from './AppPaths'
import type { SettingsStore } from './SettingsStore'

/** Ширина окна: одна колонка — состояние, режим и журнал. */
const WIDTH = 560
/** Высота окна: по высоте экрана, но не больше этой и не меньше `MIN_HEIGHT`. */
const MAX_HEIGHT = 1100
const MIN_HEIGHT = 520

/** Через сколько показать окно, если первой отрисовки так и не было, мс. */
const SHOW_FALLBACK_MS = 3000

/** Окно и его показ / скрытие. */
export class MainWindow {
  private readonly paths: AppPaths
  private readonly settings: SettingsStore
  /** Окно (создаётся заново, если его закрыли). */
  win: BrowserWindow | null = null
  /** Программа завершается — окно можно закрыть по-настоящему. */
  quitting = false
  /** Вызывается, когда окно показали или спрятали (обновить трей). */
  onVisibilityChange: () => void = () => {}
  /** Есть ли значок в трее (без него прятать окно в Dock нельзя). */
  hasTray: () => boolean = () => false
  /** Куда сообщать о сбоях окна (не загрузилось, процесс окна упал). */
  onProblem: (problem: Message) => void = () => {}

  constructor(paths: AppPaths, settings: SettingsStore) {
    this.paths = paths
    this.settings = settings
  }

  /**
   * Создаёт окно: узкое, во всю высоту рабочей области экрана (как столбец журнала).
   * @param hidden Не показывать: запуск свёрнутым в трей.
   */
  create(hidden = false): BrowserWindow {
    const workArea = screen.getPrimaryDisplay().workAreaSize
    const win = new BrowserWindow({
      width: WIDTH,
      height: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, workArea.height - 40)),
      // постоянный размер, из кнопок окна — только «закрыть»
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      trafficLightPosition: { x: 18, y: 18 },
      backgroundColor: '#17181c',
      // Windows / Linux: без строки меню «File Edit View…» (Alt показывает её); копирование в полях работает и так
      autoHideMenuBar: process.platform !== 'darwin',
      show: false,
      // спрятанное в трей окно не замедляет таймеры: оно слушает «звонок» телефонов (`app/bellListener`)
      webPreferences: { preload: this.paths.preload, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    })
    this.win = win
    // окно показывается по первой отрисовке; если её нет (драйвер, виртуальная машина) — всё равно через 3 с,
    // иначе программа работает без окна и это выглядит как «не запустилась»
    const reveal = () => {
      if (!win.isDestroyed() && !win.isVisible()) win.show()
    }
    if (hidden) {
      // macOS: без значка в Dock, как у программы строки меню
      if (process.platform === 'darwin') app.dock?.hide()
    } else {
      win.once('ready-to-show', reveal)
      win.webContents.once('did-finish-load', reveal)
      setTimeout(reveal, SHOW_FALLBACK_MS)
    }
    win.webContents.on('did-fail-load', (_e, code, description, url) => this.onProblem(message('event.windowNotLoaded', { error: `${description} (${code}) ${url}` })))
    win.webContents.on('render-process-gone', (_e, d) => this.onProblem(message('event.windowGone', { reason: d.reason, code: d.exitCode })))
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
    if (process.env.VITE_DEV) void win.loadURL('http://localhost:5173')
    else void win.loadFile(this.paths.rendererIndex)
    win.on('close', (e) => {
      if (this.quitting) return
      if (this.settings.getSnapshot().trayMinimize || process.platform === 'darwin') {
        e.preventDefault()
        this.hide()
      }
    })
    win.on('closed', () => {
      this.win = null
    })
    return win
  }

  /** Отправляет событие окну. */
  send(channel: string, payload: unknown): void {
    this.win?.webContents.send(channel, payload)
  }

  /** Прячет окно в трей (на macOS — и значок из Dock, как у приложения строки меню). */
  hide(): void {
    if (!this.win) return
    this.win.hide()
    if (process.platform === 'darwin' && this.settings.getSnapshot().trayMinimize && this.hasTray()) app.dock?.hide()
    this.onVisibilityChange()
  }

  /** Показывает окно (и переключает вкладку). */
  show(tab?: TabId): void {
    const win = this.win ?? this.create()
    const go = () => {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      if (tab) win.webContents.send(IPC.navigate, tab)
      this.onVisibilityChange()
    }
    if (process.platform === 'darwin' && app.dock) app.dock.show().then(go, go)
    else go()
  }

  /** Окно видно и в фокусе. */
  get focused(): boolean {
    return !!this.win?.isVisible() && this.win.isFocused()
  }
}
