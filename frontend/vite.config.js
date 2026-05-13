import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Bake a build identifier into the bundle so it's trivial to confirm the
// browser is running the freshly-built code (vs. a cached old bundle).
const BUILD_ID = new Date().toISOString().replace('T', ' ').slice(0, 16)

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
