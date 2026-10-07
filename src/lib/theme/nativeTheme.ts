import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core'
import type { Theme, ThemePreference } from './theme'

/**
 * Локальный плагин `NativeTheme`: `android/.../NativeThemePlugin.java` и `ios/App/App/NativeThemePlugin.swift`.
 * Подгоняет системные элементы (диалоги, панели действий, клавиатуру, фон под WebView) под тему приложения.
 */
interface NativeThemePlugin {
  /** Режим темы для нативных элементов: `system` | `light` | `dark`. */
  setMode(options: { mode: ThemePreference }): Promise<void>
  /** Цвет фона окна и WebView (`--bg`). */
  setWindowBackground(options: { background: string }): Promise<void>
}

/** Плагин есть только в нативных сборках; в браузере он не вызывается. */
const NativeTheme = registerPlugin<NativeThemePlugin>('NativeTheme')

/** Ошибки нативной части не должны ломать интерфейс: тема веб-части уже применена. */
const ignore = () => undefined

/**
 * Цвет в виде `#rrggbb`: нативные разборщики (Android `Color.parseColor`, Capacitor на iOS)
 * не понимают короткую запись `#fff`, которой пользуются токены CSS.
 */
export function toHex6(color: string): string {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color.trim())
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : color.trim()
}

/** Применяет выбор темы к нативным элементам через плагин `NativeTheme` (Android и iOS). */
export function applyNativeThemeMode(preference: ThemePreference) {
  if (Capacitor.isNativePlatform()) void NativeTheme.setMode({ mode: preference }).catch(ignore)
}

/**
 * Красит системные панели под итоговую тему: значки контрастны фону (светлые на тёмной теме
 * и наоборот), а фон окна и WebView совпадает с фоном приложения (без вспышек системного цвета).
 *
 * Значки задаются через встроенный `SystemBars` Capacitor: он запоминает стиль и сам
 * восстанавливает его после смены конфигурации (например, после возврата из камеры).
 * @param background Цвет фона приложения (`--bg`).
 */
export function applyNativeSystemBars(theme: Theme, background: string) {
  if (!Capacitor.isNativePlatform()) return
  void SystemBars.setStyle({ style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(ignore)
  void NativeTheme.setWindowBackground({ background: toHex6(background) }).catch(ignore)
}
