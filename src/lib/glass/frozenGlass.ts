import { Capacitor, registerPlugin } from '@capacitor/core'
import { useLayoutEffect, useState, type RefObject } from 'react'
import { frostPixels, parseGlassFilter } from './frost'

/**
 * Неподвижное стекло окон «Настройки» и «Загрузки» (Liquid Glass).
 *
 * Живое `backdrop-filter` GPU пересчитывает на каждом кадре, в котором под окном или в нём самом что-то
 * меняется: прокрутка, смена вкладки, нажатие, крутилка — и всегда по всей площади окна, даже если движется
 * значок в 40 px. Под открытым окном экран неподвижен, поэтому стекло окна — снимок экрана перед открытием,
 * один раз размытый тем же фильтром, что в CSS: на вид то же стекло, а кадр стоит как без размытия.
 *
 * Снимок делает локальный плагин `ScreenSnapshot` (`android/.../ScreenSnapshotPlugin.java`,
 * `ios/App/App/ScreenSnapshotPlugin.swift`). Нет снимка (браузер, Android до 8, снимок не успел) — окно
 * на живом размытии, как раньше.
 */

/** Локальный плагин снимка экрана. */
interface ScreenSnapshotPlugin {
  /** Снимок WebView размером `width` × `height` пикселей; `image` — PNG в виде data URL. */
  capture(options: { width: number; height: number }): Promise<{ image: string }>
}

const ScreenSnapshot = registerPlugin<ScreenSnapshotPlugin>('ScreenSnapshot')

/** Пикселей снимка на CSS-пиксель: размытое стекло мельче не различает, а точек в 16 раз меньше. */
const SNAPSHOT_SCALE = 1 / 4

/** Сколько ждать снимок после нажатия кнопки окна, мс: дольше — окно открывается сразу, на живом размытии. */
const SNAPSHOT_TIMEOUT_MS = 250

/** Свойство CSS с фильтром стекла окон (`platform-ios.css`): снимок размывается им же. */
const WINDOW_GLASS_FILTER = '--glass-window-blur'

/** Атрибуты `<html>`, со сменой которых меняется экран под окном (тема, оформление): снимок устарел. */
const LOOK_ATTRIBUTES = ['data-theme', 'data-platform', 'data-ios-design']

/** Неподвижное стекло: размытый снимок экрана (`url`) и размер экрана в CSS-пикселях на момент снимка. */
export interface FrozenGlass {
  url: string
  width: number
  height: number
}

/** Снимок, размытый как стекло: адрес картинки, её раскодированная копия и размер экрана на момент снимка. */
interface Frozen {
  glass: FrozenGlass
  /** Пока на картинку есть ссылка, браузер не выбрасывает её раскодированной из памяти. */
  image: HTMLImageElement
}

/** Сколько снимок, начатый при касании кнопки окна, считается свежим, мс: дольше держали палец — экран мог измениться. */
const PREPARED_FRESH_MS = 1000

/** Стекло открытого (или последнего) окна: его адрес освобождается, когда окну дают новый снимок. */
let latest: Frozen | null = null

/** Снимок, начатый заранее — при касании кнопки окна. */
let pending: { startedAt: number; work: Promise<Frozen | null> } | null = null

/** Загружает и раскодирует картинку. */
async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = url
  await image.decode()
  return image
}

/** Освобождает адрес снимка, который окну так и не дали. */
function release(work: Promise<Frozen | null>) {
  void work.then((frozen) => frozen && URL.revokeObjectURL(frozen.glass.url))
}

/**
 * Снимает экран и размывает снимок, как стекло окна. null — снимка нет: не iOS-оформление, браузер (нет плагина),
 * Android до 8, ошибка.
 */
async function freeze(): Promise<Frozen | null> {
  const root = document.documentElement
  if (!Capacitor.isNativePlatform() || root.dataset.platform !== 'ios') return null
  const steps = parseGlassFilter(getComputedStyle(root).getPropertyValue(WINDOW_GLASS_FILTER))
  if (!steps) return null
  const screenWidth = window.innerWidth
  const screenHeight = window.innerHeight
  const width = Math.max(1, Math.round(screenWidth * SNAPSHOT_SCALE))
  const height = Math.max(1, Math.round(screenHeight * SNAPSHOT_SCALE))
  try {
    const { image } = await ScreenSnapshot.capture({ width, height })
    const snapshot = await loadImage(image)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(snapshot, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height)
    frostPixels(pixels.data, width, height, steps, SNAPSHOT_SCALE)
    context.putImageData(pixels, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return null
    const url = URL.createObjectURL(blob)
    return { glass: { url, width: screenWidth, height: screenHeight }, image: await loadImage(url) }
  } catch {
    return null
  }
}

/**
 * Начинает снимок заранее — при касании кнопки окна, пока ни одно окно не открыто: к отпусканию пальца стекло
 * обычно готово, и окно открывается без задержки.
 */
export function prepareFrozenGlass() {
  if (pending && performance.now() - pending.startedAt < PREPARED_FRESH_MS) return
  if (pending) release(pending.work)
  pending = { startedAt: performance.now(), work: freeze() }
}

/** Снимок, начатый заранее, не понадобился (окно не открывается). */
export function discardFrozenGlass() {
  if (pending) release(pending.work)
  pending = null
}

/**
 * Стекло для окна, которое сейчас откроется: снимок экрана (начатый при касании или сейчас), размытый как стекло
 * окна. null — снимка нет или он не успел за `SNAPSHOT_TIMEOUT_MS`: окно открывается сразу, на живом размытии.
 * Вызывать, пока ни одно окно не открыто и не закрывается: иначе оно попадёт в снимок.
 */
export async function takeFrozenGlass(): Promise<FrozenGlass | null> {
  prepareFrozenGlass()
  const work = pending!.work
  pending = null
  const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), SNAPSHOT_TIMEOUT_MS))
  const frozen = await Promise.race([work, timeout])
  if (!frozen) {
    // Опоздавший снимок уже не нужен.
    release(work)
    return null
  }
  if (latest) URL.revokeObjectURL(latest.glass.url)
  latest = frozen
  return frozen.glass
}

/** Положение рамки элемента на экране без учёта трансформаций (окно в это время может ехать и масштабироваться). */
function layoutOrigin(element: HTMLElement): { x: number; y: number } {
  let x = 0
  let y = 0
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft
    y += node.offsetTop
    if (node !== element) {
      x += node.clientLeft
      y += node.clientTop
    }
  }
  return { x, y }
}

/**
 * Стекло окна `ref` — снимок `glass`, совмещённый с экраном (`FrozenGlassLayer`): под окном виден тот же размытый
 * экран, что дало бы живое размытие. Возвращает снимок, пока он годен, — тогда окно рисует слой снимка и снимает
 * живое размытие (`data-frozen-glass`). Поменялись тема или оформление, сменилась ширина экрана — снимок устарел:
 * null, окно возвращается к живому размытию.
 */
export function useFrozenGlass(ref: RefObject<HTMLElement | null>, glass: FrozenGlass | null): FrozenGlass | null {
  const [stale, setStale] = useState<FrozenGlass | null>(null)
  const active = glass !== stale ? glass : null
  useLayoutEffect(() => {
    const host = ref.current
    if (!host || !active) return
    // Слой снимка внутри окна стоит от края его рамки — туда, где на экране начало снимка.
    // Окно меняет высоту на каждом кадре перехода между вкладками: пока его начало на месте, стиль не трогаем.
    let placed = ''
    const place = () => {
      const { x, y } = layoutOrigin(host)
      const key = `${x + host.clientLeft} ${y + host.clientTop}`
      if (key === placed) return
      placed = key
      host.style.setProperty('--frozen-glass-x', `${-(x + host.clientLeft)}px`)
      host.style.setProperty('--frozen-glass-y', `${-(y + host.clientTop)}px`)
    }
    place()
    // Окно по центру (компьютер) сдвигается, когда меняет высоту.
    const resize = new ResizeObserver(place)
    resize.observe(host)
    const thaw = () => setStale(active)
    const look = new MutationObserver(thaw)
    look.observe(document.documentElement, { attributes: true, attributeFilter: LOOK_ATTRIBUTES })
    const onWindowResize = () => (window.innerWidth === active.width ? place() : thaw())
    window.addEventListener('resize', onWindowResize)
    return () => {
      resize.disconnect()
      look.disconnect()
      window.removeEventListener('resize', onWindowResize)
    }
  }, [ref, active])
  return active
}
