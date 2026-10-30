/**
 * Сборка главного процесса Electron (`src/host`) в `dist-host/`: `main.cjs`, затем (`--mode preload`) `preload.cjs`.
 *
 * Формат CommonJS. Preload собирается отдельно и одним файлом: в песочнице Electron он может подключать только
 * `electron`, а не соседние файлы. Electron и встроенные модули Node не встраиваются; JSZip берётся
 * из `node_modules` приложения. *
 * Клиент OAuth для Google Drive (тип «Приложение для компьютера») можно встроить при сборке:
 * `SOMASYNC_GOOGLE_CLIENT_ID=… SOMASYNC_GOOGLE_CLIENT_SECRET=… npm run dist:win`. Без них клиент берётся
 * из `google-oauth.json` в папке данных программы (см. `host/drive/GoogleOAuth`).
 */
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
  const preload = mode === 'preload'
  const input: Record<string, string> = preload ? { preload: 'src/host/preload.ts' } : { main: 'src/host/main.ts' }
  const clientId = process.env.SOMASYNC_GOOGLE_CLIENT_ID?.trim()
  const googleClient = clientId ? { clientId, clientSecret: process.env.SOMASYNC_GOOGLE_CLIENT_SECRET?.trim() ?? '' } : null
  return {
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    define: { __GOOGLE_OAUTH_CLIENT__: JSON.stringify(googleClient) },
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
