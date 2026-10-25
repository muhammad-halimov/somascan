/**
 * Сборка главного процесса Electron (`src/host`) в `dist-host/`: `main.cjs`, затем (`--mode preload`) `preload.cjs`.
 *
 * Формат CommonJS. Preload собирается отдельно и одним файлом: в песочнице Electron он может подключать только
 * `electron`, а не соседние файлы. Electron и встроенные модули Node не встраиваются; JSZip берётся
 * из `node_modules` приложения.
 */
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
  const preload = mode === 'preload'
  const input: Record<string, string> = preload ? { preload: 'src/host/preload.ts' } : { main: 'src/host/main.ts' }
  return {
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
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
