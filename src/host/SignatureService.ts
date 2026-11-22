/**
 * Подписи рабочих мест (мастер цеха, лаборант, контролёр качества — вкладка «Расширенные» своего рабочего места):
 * изображение с прозрачным фоном, которое накладывается на документы поверх текста.
 *
 * Выбранный файл проверяется (это изображение, в нём есть прозрачные пиксели), прозрачные поля вокруг подписи
 * обрезаются (подпись занимает всё изображение — и в превью, и на документе), слишком большое — уменьшается;
 * результат — PNG в папке данных программы: `userData/signatures/<место>-<время>.png`; путь — в настройках
 * (`AppSettings.signatures`). Имя меняется при каждой замене — окно видит новое превью; прежний файл удаляется.
 * Движок получает путь при чтении таблицы лаборатории (`SIGNATURE`), окно — превью (`preview`).
 */
import fs from 'node:fs'
import path from 'node:path'
import { dialog, nativeImage, type BrowserWindow } from 'electron'
import { message } from '@/shared/messages'
import type { ActionResult, SignatureImage } from '@/shared/protocol'
import type { Workplace } from '@/shared/settings'
import type { AppPaths } from './AppPaths'
import type { Journal } from './Journal'
import { contentBox, hasTransparency } from './signatureImage'
import type { SettingsStore } from './SettingsStore'

/** Наибольшая ширина хранимой подписи, px: больше — уменьшается (подпись на документе — несколько сантиметров). */
const MAX_WIDTH = 1600

/** Подписи рабочих мест. */
export class SignatureService {
  private readonly settings: SettingsStore
  private readonly journal: Journal
  /** Папка подписей. */
  private readonly dir: string

  constructor(paths: AppPaths, settings: SettingsStore, journal: Journal) {
    this.settings = settings
    this.journal = journal
    this.dir = path.join(paths.data, 'signatures')
  }

  /** Превью подписи или `null`, если не выбрана или файла нет. */
  async preview(place: Workplace): Promise<SignatureImage | null> {
    const file = this.settings.getSnapshot().signatures[place]
    if (!file) return null
    const bytes = await fs.promises.readFile(file).catch(() => null)
    if (!bytes) return null
    const { width, height } = nativeImage.createFromBuffer(bytes).getSize()
    return { dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, width, height }
  }

  /**
   * Выбор изображения: проверка и копия в папку данных.
   * @returns `null` — выбор отменён; иначе итог (ошибка — почему изображение не подходит).
   */
  async pick(place: Workplace, win: BrowserWindow | null): Promise<ActionResult | null> {
    const options = { properties: ['openFile' as const], filters: [{ name: 'PNG', extensions: ['png'] }] }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    const source = r.canceled ? null : r.filePaths[0]
    if (!source) return null
    let image = nativeImage.createFromPath(source)
    if (image.isEmpty()) return { ok: false, error: message('signature.notImage') }
    const bitmap = image.toBitmap()
    if (!hasTransparency(bitmap)) return { ok: false, error: message('signature.noAlpha') }
    const { width, height } = image.getSize()
    const box = contentBox(bitmap, width, height)
    if (!box) return { ok: false, error: message('signature.blank') }
    image = image.crop(box)
    if (box.width > MAX_WIDTH) image = image.resize({ width: MAX_WIDTH, quality: 'best' })
    const file = path.join(this.dir, `${place}-${Date.now()}.png`)
    try {
      await fs.promises.mkdir(this.dir, { recursive: true })
      await fs.promises.writeFile(file, image.toPNG())
    } catch (e) {
      return { ok: false, error: message('signature.saveFailed', { error: (e as Error).message }) }
    }
    await this.forget(place)
    this.settings.update({ signatures: { [place]: file } })
    this.journal.event('ok', message('event.signatureSet', { file: path.basename(source) }))
    return { ok: true }
  }

  /** Убирает подпись: файл удаляется, в настройках — пусто. */
  async remove(place: Workplace): Promise<void> {
    if (!this.settings.getSnapshot().signatures[place]) return
    await this.forget(place)
    this.settings.update({ signatures: { [place]: '' } })
    this.journal.event('info', message('event.signatureRemoved'))
  }

  /** Удаляет файл текущей подписи — только из папки подписей (чужие файлы не трогаем). */
  private async forget(place: Workplace): Promise<void> {
    const file = this.settings.getSnapshot().signatures[place]
    if (file && path.dirname(file) === this.dir) await fs.promises.rm(file, { force: true })
  }
}
