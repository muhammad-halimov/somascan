/**
 * Сборка главного процесса Electron (`src/host`) в `dist-host/`: `main.cjs`, затем (`--mode preload`) `preload.cjs`.
 *
 * Формат CommonJS. Preload собирается отдельно и одним файлом: в песочнице Electron он может подключать только
 * `electron`, а не соседние файлы. Electron и встроенные модули Node не встраиваются; JSZip берётся
 * из `node_modules` приложения. *
 * Клиент OAuth для Google Drive (тип «Приложение для компьютера») встраивается при сборке: из
 * `SOMASYNC_GOOGLE_CLIENT_ID=… SOMASYNC_GOOGLE_CLIENT_SECRET=… npm run dist:win`, иначе из `google-oauth.json`
 * в корне проекта (JSON из Google Cloud Console как есть; в репозиторий не попадает). Без них клиент берётся
 * из `google-oauth.json` в папке данных программы (см. `host/drive/GoogleOAuth`).
 */
import fs from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

/** Клиент OAuth для сборки: переменные окружения, иначе `google-oauth.json` в корне проекта; `null` — не встраивается. */
function googleClient(): { clientId: string; clientSecret: string } | null {
  const envId = process.env.SOMASYNC_GOOGLE_CLIENT_ID?.trim()
  if (envId) return { clientId: envId, clientSecret: process.env.SOMASYNC_GOOGLE_CLIENT_SECRET?.trim() ?? '' }
  const file = fileURLToPath(new URL('./google-oauth.json', import.meta.url))
  if (!fs.existsSync(file)) return null
  // формат Google Cloud Console: {"installed": {...}} или {"web": {...}}; плоский {client_id, client_secret} тоже подходит
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Record<string, unknown> | undefined>
  const src = raw.installed ?? raw.web ?? (raw as Record<string, unknown>)
  const clientId = typeof src.client_id === 'string' ? src.client_id.trim() : ''
  if (!clientId) throw new Error('google-oauth.json: нет client_id')
  return { clientId, clientSecret: typeof src.client_secret === 'string' ? src.client_secret.trim() : '' }
}

export default defineConfig(({ mode }) => {
  const preload = mode === 'preload'
  const input: Record<string, string> = preload ? { preload: 'src/host/preload.ts' } : { main: 'src/host/main.ts' }
  return {
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    define: { __GOOGLE_OAUTH_CLIENT__: JSON.stringify(googleClient()) },
    build: {
      outDir: 'dist-host',
      emptyOutDir: !preload,
      ssr: true,
      target: 'node22',
      minify: false,
      rolldownOptions: {
        input,
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  }
})
