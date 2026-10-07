/**
 * Конфигурация сборки Vite.
 *
 * - `@/` указывает на `src/`, чтобы импорты не поднимались через `../../`.
 * - `__APP_VERSION__` передаёт версию пакета в блок «О приложении» в настройках.
 *
 * API-ключи намеренно не подставляются здесь: всё, что определено на этапе сборки, попадает
 * в JS-бандл и может быть прочитано из APK/IPA. Ключи вводятся в настройках приложения.
 */
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
})
