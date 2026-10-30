/**
 * Конфигурация сборки Vite.
 *
 * - `@/` указывает на `src/`, чтобы импорты не поднимались через `../../`.
 * - `__APP_VERSION__` передаёт версию из `package.json` в блок «О приложении» в настройках (и при сборке
 *   не через `npm run`, когда `npm_package_version` не задана).
 *
 * API-ключи намеренно не подставляются здесь: всё, что определено на этапе сборки, попадает
 * в JS-бандл и может быть прочитано из APK/IPA. Ключи вводятся в настройках приложения.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** Версия приложения — из `package.json`. */
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
})
