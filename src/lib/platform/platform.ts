/**
 * Платформа и поколение дизайна iOS.
 *
 * На `<html>` ставятся атрибуты, к которым привязаны платформенные стили (`styles/platform-ios.css`):
 * - `data-platform` — `ios` | `android` | `web`;
 * - `data-ios-design` — `glass` (iOS 26+, Liquid Glass) или `classic` (iOS 18 и раньше: материалы с размытием);
 * - `data-native` — приложение запущено нативно (Capacitor).
 *
 * Отклик на касания (атрибуты `data-press`, `data-keyboard`) ставит `lib/interaction`.
 */
import { Capacitor } from '@capacitor/core'
import { Device } from '@capacitor/device'

/** Платформа для стилей. */
export type StylePlatform = 'ios' | 'android' | 'web'

/** Первая версия iOS с дизайном Liquid Glass. */
const LIQUID_GLASS_MIN_IOS = 26

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

/** Ставит атрибуты на `<html>`. */
function applyAttributes(platform: StylePlatform, iosMajor: number | null) {
  const root = document.documentElement
  root.dataset.platform = platform
  if (Capacitor.isNativePlatform()) root.dataset.native = 'true'
  if (platform === 'ios') root.dataset.iosDesign = (iosMajor ?? 0) >= LIQUID_GLASS_MIN_IOS ? 'glass' : 'classic'
  else delete root.dataset.iosDesign
}

/**
 * Определяет платформу и поколение дизайна. Сначала сразу (по user-agent), чтобы первый кадр
 * был в нужном стиле, затем уточняет точную версию iOS через плагин Device в нативном приложении.
 */
export function initPlatform() {
  const platform = stylePlatform()
  applyAttributes(platform, guessIosMajor())
  if (platform !== 'ios' || !Capacitor.isNativePlatform()) return
  void Device.getInfo()
    .then((info) => applyAttributes('ios', Number.parseInt(info.osVersion, 10) || null))
    .catch(() => undefined)
}
