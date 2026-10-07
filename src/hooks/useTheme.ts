import { useEffect, useSyncExternalStore } from 'react'
import { Capacitor } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import { applyNativeSystemBars, applyNativeThemeMode } from '@/lib/theme/nativeTheme'
import { applyTheme, DARK_SCHEME_QUERY, resolveTheme, systemPrefersDark, type Theme, type ThemePreference } from '@/lib/theme/theme'

/** Подписка на смену системной темы (для `useSyncExternalStore`). */
function subscribeToSystemTheme(onChange: () => void) {
  const media = window.matchMedia(DARK_SCHEME_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/**
 * Итоговая тема (`light` / `dark`) для выбора из настроек.
 * При выборе «как в системе» перерисовывает компонент, когда система меняет тему.
 */
export function useResolvedTheme(preference: ThemePreference): Theme {
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark)
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : resolveTheme(preference)
}

/**
 * Применяет тему из настроек: веб-часть (`data-theme`), нативные диалоги, фон и значки
 * системных панелей. Заодно скрывает сплэш-экран после первого кадра.
 * Самая первая установка темы делается ещё раньше — скриптом в `index.html`.
 */
export function useTheme(preference: ThemePreference) {
  const theme = useResolvedTheme(preference)

  // Нативные диалоги — в тот же режим, что выбран в приложении.
  useEffect(() => {
    applyNativeThemeMode(preference)
  }, [preference])

  useEffect(() => {
    applyTheme(theme)
    // Цвет фона берём из токенов уже после смены темы, чтобы панель совпала с шапкой.
    const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    applyNativeSystemBars(theme, background)
  }, [theme])

  // Сплэш убираем, только когда первый кадр уже нарисован, — без белой вспышки.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (Capacitor.isNativePlatform()) void SplashScreen.hide({ fadeOutDuration: 180 }).catch(() => undefined)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  return theme
}
