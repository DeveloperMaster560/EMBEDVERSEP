import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { createArduinoCompileMiddleware } from './server/arduinoCompiler.js'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(() => ({
  server: {
    port: 5174,
    strictPort: true,
  },
  plugins: [
    react(),
    {
      name: 'embedverse-backend-apis',
      configureServer(server) {
        server.middlewares.use('/api/compile', createArduinoCompileMiddleware(projectRoot))
      },
      configurePreviewServer(server) {
        server.middlewares.use('/api/compile', createArduinoCompileMiddleware(projectRoot))
      },
    },
  ],
}))
