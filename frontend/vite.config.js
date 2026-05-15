import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // Pre-bundle deps that get imported lazily so Vite doesn't 504 on first
  // request after a fresh install (the dev server's .vite/deps cache is
  // built on startup and won't auto-include new packages mid-session).
  optimizeDeps: {
    include: ['jspdf'],
  },
  server: {
    host: true,
    port: 3000,
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io'],
    historyApiFallback: true,
    // Proxy backend through Vite so frontend + backend share a single origin
    // when accessed via ngrok. Required for the HttpOnly pabbly_token cookie
    // set by /api/auth/tauth to round-trip on /api/me and other API calls.
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
})
