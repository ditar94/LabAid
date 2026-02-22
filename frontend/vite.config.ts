import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'


/** Rewrite non-file routes to /app.html so the React SPA handles them in dev. */
function spaFallback(): Plugin {
  return {
    name: 'spa-fallback',
    configureServer(server) {
      // Use pre-middleware (no return wrapper) so it runs before Vite's static file serving
      server.middlewares.use((req, _res, next) => {
        if (
          req.url &&
          !req.url.includes('.') &&
          req.url !== '/' &&
          !req.url.startsWith('/pricing') &&
          !req.url.startsWith('/api') &&
          !req.url.startsWith('/@') &&        // Vite internals (@react-refresh, @vite, @fs, etc.)
          !req.url.startsWith('/node_modules') &&
          !req.url.startsWith('/src')
        ) {
          req.url = '/app.html'
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react() /*, basicSsl() */, spaFallback()],
  server: {
    host: true,
    proxy: {
      '/api': {
        // Use 'backend' for Docker, 'localhost' for running outside Docker
        target: process.env.DOCKER ? 'http://backend:8000' : 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'app.html'),
        landing: resolve(__dirname, 'index.html'),
        pricing: resolve(__dirname, 'pricing.html'),
      },
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
})
