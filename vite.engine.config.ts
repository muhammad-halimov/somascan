/**
 * Сборка движка (`src/engine`) в `dist-engine/sync.mjs`.
 *
 * Движок — отдельный процесс Node (главный процесс запускает его как `ELECTRON_RUN_AS_NODE`), без React и Electron.
 * ExcelJS и JSZip не встраиваются: они в `dependencies` и попадают в приложение из `node_modules`.
 * `__ENGINE_VERSION__` — версия пакета: движок печатает её первой строкой журнала.
 */
import fs from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { __ENGINE_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: 'dist-engine',
    emptyOutDir: true,
    ssr: true,
    target: 'node22',
    minify: false,
    rolldownOptions: {
      input: { sync: 'src/engine/main.ts' },
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' },
    },
  },
})
