/**
 * Точка входа окна: стили, переводы, связь с главным процессом, первый рендер.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import { initI18n } from '@/app/i18n'
import { startSession } from '@/app/state'
import '@/styles/index.css'

initI18n('en')

// первый рендер — когда настройки, состояние и журнал уже получены от главного процесса (язык — из настроек)
void startSession().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
