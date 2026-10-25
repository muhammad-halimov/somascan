/**
 * Где лежат файлы программы.
 *
 *   userData/state.json   настройки (`SettingsStore`)
 *   userData/log.txt      журнал (`Journal`)
 *   userData/links.json   ручные привязки элементов к блокам (`LinksService`)
 * Движок запускается с рабочей папкой userData.
 *
 * Сборка кладёт главный процесс в `dist-host/`, окно — в `dist/`, движок — в `dist-engine/`, значки трея — в `assets/`;
 * `appRoot` — папка над ними (корень проекта или `Somasync.app/Contents/Resources/app`).
 */
import path from 'node:path'
import { app } from 'electron'

/** Пути программы. */
export class AppPaths {
  /** Папка данных пользователя. */
  readonly data: string
  /** Корень приложения. */
  readonly appRoot: string

  constructor() {
    this.data = app.getPath('userData')
    this.appRoot = path.join(__dirname, '..')
  }

  /** Настройки. */
  get stateFile(): string {
    return path.join(this.data, 'state.json')
  }

  /** Журнал. */
  get logFile(): string {
    return path.join(this.data, 'log.txt')
  }

  /** Ручные привязки. */
  get linksFile(): string {
    return path.join(this.data, 'links.json')
  }

  /** Движок. */
  get engine(): string {
    return path.join(this.appRoot, 'dist-engine')
  }

  /** Окно (собранное). */
  get rendererIndex(): string {
    return path.join(this.appRoot, 'dist', 'index.html')
  }

  /** Preload окна. */
  get preload(): string {
    return path.join(__dirname, 'preload.cjs')
  }

  /** Значки трея. */
  get assets(): string {
    return path.join(this.appRoot, 'assets')
  }
}
