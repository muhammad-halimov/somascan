/**
 * Somasync — главный процесс: настройки, слежение за Consum, запуск движка, окно и трей (см. `HostServices`).
 * Состояние «работает / остановлено» хранится в настройках: после перезапуска программа продолжает с того же места.
 */
import { app, dialog } from 'electron'
import { message } from '@/shared/messages'
import { HostServices } from './HostServices'
import { applyTheme, registerIpc } from './ipc'

/** Сколько ждать окончания прогона при выходе, мс. */
const QUIT_WAIT_MS = 60_000
/** Шаг ожидания, мс. */
const QUIT_POLL_MS = 500
/**
 * Сколько после запуска свёрнутым не показывать окно по повторному запуску, мс. При входе в систему macOS
 * открывает программу дважды (пункт входа и «Открывать окна снова при входе»): второй запуск приходит
 * как `activate` / `second-instance` и показал бы окно. Из трея окно открывается всегда.
 */
const HIDDEN_START_GRACE_MS = 30_000

app.setName('Somasync')
// Windows: без аппаратного ускорения — на виртуальных машинах и со старыми драйверами окно иначе может не отрисоваться
if (process.platform === 'win32') app.disableHardwareAcceleration()

if (!app.requestSingleInstanceLock()) app.quit()
else {
  const h = new HostServices()
  /** До этого времени повторный запуск окно не показывает (запуск свёрнутым). */
  let quietUntil = 0
  const reopen = () => {
    if (Date.now() >= quietUntil) h.window.show()
  }
  app.on('second-instance', reopen)
  // ошибки главного процесса — в журнал (log.txt), а не в никуда
  process.on('uncaughtException', (e) => h.journal.event('err', message('event.error', { error: e.stack ?? e.message })))
  process.on('unhandledRejection', (e) => h.journal.event('err', message('event.error', { error: e instanceof Error ? (e.stack ?? e.message) : String(e) })))
  app.on('child-process-gone', (_e, d) => {
    if (d.type === 'GPU' || d.reason !== 'clean-exit') h.journal.event('warn', message('event.processGone', { type: d.type, reason: d.reason, code: d.exitCode }))
  })

  app.whenReady().then(() => {
    h.settings.load()
    h.journal.trimFile()
    applyTheme(h.settings.getSnapshot().theme)
    h.wire()
    registerIpc(h)
    const trayProblem = h.tray.create()
    if (trayProblem) h.journal.event('warn', message('event.trayUnavailable', { error: trayProblem }))
    // свёрнутым — только если есть значок, из которого окно можно открыть
    const hidden = h.settings.getSnapshot().startMinimized && h.tray.exists
    if (hidden) quietUntil = Date.now() + HIDDEN_START_GRACE_MS
    const win = h.window.create(hidden)
    h.journal.event('info', message('event.appStarted', { version: app.getVersion() }))
    // продолжаем с того же места: если слежение было включено перед выходом — включаем снова
    if (h.settings.getSnapshot().running) {
      h.journal.event('info', message('event.resume'))
      win.webContents.once('did-finish-load', () => void h.watcher.start())
    }
    app.on('activate', reopen)
  }).catch((e: unknown) => {
    // запуск не удался: сказать об этом, а не висеть процессом без окна
    const text = e instanceof Error ? (e.stack ?? e.message) : String(e)
    h.journal.event('err', message('event.startFailed', { error: text }))
    dialog.showErrorBox(h.settings.text(message('tray.startFailed')), `${text}\n\n${h.settings.text(message('tray.logAt', { file: h.paths.logFile }))}`)
    app.exit(1)
  })

  app.on('before-quit', (e) => {
    if (h.window.quitting) return
    h.tray.destroy()
    h.window.quitting = true
    h.watcher.halt()
    if (h.sync.getSnapshot().busy || h.runner.active) {
      // не обрываем запись в файлы посреди прогона
      e.preventDefault()
      void (async () => {
        for (let waited = 0; waited < QUIT_WAIT_MS && (h.sync.getSnapshot().busy || h.runner.active); waited += QUIT_POLL_MS) await new Promise((r) => setTimeout(r, QUIT_POLL_MS))
        app.quit()
      })()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !h.settings.getSnapshot().trayMinimize) app.quit()
  })
}
