/**
 * Платформа и оформление.
 *
 * На `<html>` ставятся атрибуты, к которым привязаны платформенные стили (`styles/platform-ios.css`):
 * - `data-platform` — `ios` | `android` | `web`: оформление (iOS — стили Apple, Android — Material Design);
 * - `data-ios-design` — `glass` (iOS 26+, Liquid Glass) или `classic` (iOS 18 и раньше: материалы с размытием);
 * - `data-native` — приложение запущено нативно (Capacitor);
 * - `data-device` — само устройство (`ios` | `android` | `web`), независимо от оформления: для размеров,
 *   которые задаёт система (полоска «Домой» у iPhone ниже полоски жестов Android).
 * Оформление можно выбрать в «Расширенных» (`applyDesign`): Liquid Glass или Material Design на любом устройстве.
 * От атрибутов зависит только вид; поведение, зависящее от устройства (клавиатура, «Назад»), смотрит
 * на `Capacitor.getPlatform()`.
 *
 * Отклик на касания (атрибуты `data-press`, `data-keyboard`) ставит `lib/interaction`.
 */
import { Capacitor } from '@capacitor/core'
import { Device } from '@capacitor/device'

/** Платформа для стилей. */
export type StylePlatform = 'ios' | 'android' | 'web'

/** Первая версия iOS с дизайном Liquid Glass. */
const LIQUID_GLASS_MIN_IOS = 26

/** Оформление на выбор: Liquid Glass (как iOS 26) или Material Design (как Android). */
export const DESIGNS = ['glass', 'material'] as const

/** Оформление. */
export type Design = (typeof DESIGNS)[number]

/** Стиль каждого оформления. */
const DESIGN_PLATFORMS: Record<Design, StylePlatform> = { glass: 'ios', material: 'android' }

/** Устройство: платформа для стилей и версия iOS. */
const device: { platform: StylePlatform; iosMajor: number | null } = { platform: 'web', iosMajor: null }

/** Выбранное оформление; `null` — как у устройства. */
let chosenDesign: Design | null = null

/** Устройство Apple с сенсорным экраном (в том числе iPad, который представляется «Macintosh»). */
const isAppleTouchDevice = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)

/** Данные, которые нативная оболочка iOS кладёт в страницу до её загрузки (см. SomascanBridgeViewController). */
interface NativeShellInfo {
  platform: 'ios'
  osVersion: string
}

/**
 * Предварительная версия iOS. Точная — от нативной оболочки (`window.__somascanNative`);
 * в браузере — из user-agent, что ненадёжно: с iOS 26 Safari «замораживает» версию ОС
 * в UA на 18.x, поэтому сначала смотрим версию браузера (`Version/26.0`).
 */
function guessIosMajor(): number | null {
  const shell = (window as Window & { __somascanNative?: NativeShellInfo }).__somascanNative
  if (shell?.osVersion) return Number.parseInt(shell.osVersion, 10) || null
  const browser = /Version\/(\d+)/.exec(navigator.userAgent)
  if (browser) return Number(browser[1])
  const os = /OS (\d+)_/.exec(navigator.userAgent)
  return os ? Number(os[1]) : null
}

/** Платформа для стилей: нативная по Capacitor, в браузере — по устройству (телефон в браузере тоже сенсорный). */
function stylePlatform(): StylePlatform {
  const native = Capacitor.getPlatform()
  if (native === 'ios' || native === 'android') return native
  if (isAppleTouchDevice()) return 'ios'
  return /Android/i.test(navigator.userAgent) ? 'android' : 'web'
}

/** Ставит атрибуты на `<html>`: стиль выбранного оформления или устройства. */
function applyAttributes() {
  const root = document.documentElement
  const platform = chosenDesign ? DESIGN_PLATFORMS[chosenDesign] : device.platform
  root.dataset.platform = platform
  root.dataset.device = device.platform
  if (Capacitor.isNativePlatform()) root.dataset.native = 'true'
  // Liquid Glass по выбору — на любой версии; иначе — по версии iOS
  const glass = chosenDesign === 'glass' || (device.iosMajor ?? 0) >= LIQUID_GLASS_MIN_IOS
  if (platform === 'ios') root.dataset.iosDesign = glass ? 'glass' : 'classic'
  else delete root.dataset.iosDesign
}

/** Оформление устройства (по умолчанию): у iOS — Liquid Glass, у остальных — Material Design. */
export const deviceDesign = (): Design => (device.platform === 'ios' ? 'glass' : 'material')

/** Меняет оформление сразу, без перезапуска; `null` — как у устройства. */
export function applyDesign(design: Design | null) {
  chosenDesign = design
  applyAttributes()
}

/**
 * Определяет платформу и поколение дизайна. Сначала сразу (по user-agent), чтобы первый кадр
 * был в нужном стиле, затем уточняет точную версию iOS через плагин Device в нативном приложении.
 * @param design Оформление из настроек (`null` — как у устройства).
 */
export function initPlatform(design: Design | null) {
  device.platform = stylePlatform()
  device.iosMajor = guessIosMajor()
  chosenDesign = design
  applyAttributes()
  if (device.platform !== 'ios' || !Capacitor.isNativePlatform()) return
  void Device.getInfo()
    .then((info) => {
      device.iosMajor = Number.parseInt(info.osVersion, 10) || null
      applyAttributes()
    })
    .catch(() => undefined)
}
