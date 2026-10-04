import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    define: {
      __GEMINI_API_KEY__: JSON.stringify(env.GEMINI_GOOGLE_API_KEY ?? ''),
    },
  }
})
