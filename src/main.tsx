/**
 * Точка входа: глобальные стили, переводы, первый рендер.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { exposeDebugHandles } from '@/app/debug'
import { settingsStore } from '@/features/settings/store/SettingsStore'
import { uploadQueue } from '@/features/uploads/queue/appQueue'
import { initI18n } from '@/i18n/i18n'
import { initInteraction } from '@/lib/interaction/interaction'
import { initKeyboard } from '@/lib/platform/keyboard'
import { initPlatform } from '@/lib/platform/platform'
import '@/styles/index.css'

// Переводы готовы до первого рендера, на языке, сохранённом в настройках.
initI18n(settingsStore.getSnapshot().general.language)

// Платформенные стили (iOS: Liquid Glass или классические материалы) — тоже до первого рендера.
initPlatform()

// Касания как в нативном приложении: отклик на нажатие ведёт код, а не браузерные :active/:hover.
initInteraction()

// Клавиатура без веб-панели «‹ › Готово» (iOS).
initKeyboard()

// Очередь выгрузки в таблицу: на устройстве её пишет движок вне WebView (и в закрытом приложении),
// экран подключается к нему; в браузере очередь обрабатывается на странице.
uploadQueue.start()

// В сборке для разработки (`vite build --mode development`) сторы доступны из консоли отладчика —
// так очередь выгрузки проверяется на устройстве без production-ограничений.
if (import.meta.env.MODE !== 'production') exposeDebugHandles()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
