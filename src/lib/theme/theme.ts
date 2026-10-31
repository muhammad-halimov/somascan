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

/** Длительность плавной смены темы, мс (в CSS — `--theme-fade`, его ставит `changeTheme`). */
export const THEME_FADE_MS = 300

/**
 * Класс корня на время смены темы (`styles/animations.css`): с View Transitions задаёт длительность растворения кадра
 * (только для темы — переход в правку идёт со своей), без них — плавный переход цветов.
 */
const THEME_CHANGING_CLASS = 'is-theme-changing'

/**
 * Меняет тему плавно: старый кадр растворяется в новом (View Transitions API — Android WebView, iOS 18+), а где
 * его нет — цвета переходят за `THEME_FADE_MS`. Первая установка темы (её уже поставил скрипт в `index.html`)
 * и «уменьшить движение» — без анимации.
 * @param onApplied Вызывается сразу после смены токенов (с View Transitions — асинхронно): например, чтобы взять
 *   новый `--bg` для системных панелей.
 */
export function changeTheme(theme: Theme, onApplied: () => void = () => {}) {
  const root = document.documentElement
  const apply = () => {
    applyTheme(theme)
    onApplied()
  }
  if (root.dataset.theme === theme || !root.dataset.theme || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply()
    return
  }
  root.style.setProperty('--theme-fade', `${THEME_FADE_MS}ms`)
  root.classList.add(THEME_CHANGING_CLASS)
  const done = () => root.classList.remove(THEME_CHANGING_CLASS)
  if (typeof document.startViewTransition === 'function') {
    void document.startViewTransition(apply).finished.finally(done)
    return
  }
  apply()
  window.setTimeout(done, THEME_FADE_MS)
}

/**
 * Применяет тему к документу сразу: `data-theme` (на него завязаны токены в `styles/tokens.css`),
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
