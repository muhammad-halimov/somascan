/**
 * Сборка окна (`src/main.tsx` → `dist/`). `base: './'` — окно открывается из файла (`loadFile`), а не с сервера.
 * Движок и главный процесс собираются отдельно: `vite.engine.config.ts`, `vite.host.config.ts`.
 * Firestore (≈580 КБ) — отдельным куском: окно грузит его, только когда включён «звонок» телефонов (`app/bellListener`).
 */
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 700 },
})
