/**
 * Тема оформления без привязки к React: типы, определение и применение темы к документу.
 */

/** Варианты в настройках: как в системе, всегда светлая, всегда тёмная. */
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const

/** Выбор темы в настройках. */
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

/** Тема, которая реально применена. */
export type Theme = 'light' | 'dark'

/** Медиазапрос системной тёмной темы. */
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

/** Включена ли тёмная тема в системе. */
export const systemPrefersDark = () => window.matchMedia(DARK_SCHEME_QUERY).matches

/** Итоговая тема для выбора из настроек. */
export function resolveTheme(preference: ThemePreference): Theme {
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return preference
}

/**
 * Применяет тему к документу: `data-theme` (на него завязаны токены в `styles/tokens.css`),
 * `color-scheme` (системные контролы и полосы прокрутки) и цвет панели браузера.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  const background = getComputedStyle(root).getPropertyValue('--bg').trim()
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    // Цвет панели больше не зависит от системной темы: убираем media и задаём текущий фон.
    meta.removeAttribute('media')
    if (background) meta.content = background
  }
}
