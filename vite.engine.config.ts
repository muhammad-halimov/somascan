/**
 * Сборка движка очереди выгрузки (`src/engine`) в один файл `dist/upload-engine.js`.
 *
 * Движок запускается не в WebView приложения, а нативной частью отдельно от экрана (Android — скрытый
 * WebView процесса, iOS — JavaScriptCore), поэтому это самостоятельный IIFE без разбиения на чанки
 * (ExcelJS встроен) и без React. `cap sync` кладёт его в `public/` обоих нативных проектов вместе с веб-частью.
 * Сборка идёт после основной (`npm run build`) и не очищает `dist`.
 */
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    // JavaScriptCore iOS 16+ и WebView Android — ES2020 без транспиляции async/await.
    target: 'es2020',
    lib: { entry: 'src/engine/main.ts', formats: ['iife'], name: 'SomascanEngineBundle', fileName: () => 'upload-engine.js' },
  },
})
