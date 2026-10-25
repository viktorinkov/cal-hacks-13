import dns from 'node:dns'
import https from 'node:https'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// band1t.vip is the hackathon host. This machine often cannot resolve it, and the address is the one in LINKS.md.
const banditAgent = new https.Agent({
  lookup(hostname, options, callback) {
    if (hostname !== 'band1t.vip') {
      dns.lookup(hostname, options, callback)
      return
    }
    if (typeof options === 'object' && options.all) {
      callback(null, [{ address: '104.207.149.22', family: 4 }])
      return
    }
    callback(null, '104.207.149.22', 4)
  },
})

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target: 'https://band1t.vip', changeOrigin: true, secure: true, agent: banditAgent },
      '/config.json': { target: 'https://band1t.vip', changeOrigin: true, secure: true, agent: banditAgent },
      '/blobs': { target: 'https://band1t.vip', changeOrigin: true, secure: true, agent: banditAgent },
      '/assets/merch': { target: 'https://band1t.vip', changeOrigin: true, secure: true, agent: banditAgent },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
