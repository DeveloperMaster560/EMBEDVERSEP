import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { createArduinoCompileMiddleware } from './server/arduinoCompiler.js'
import { createBridgeGeneratorMiddleware } from './server/bridgeGenerator.js'
import { createBuildingGeneratorMiddleware } from './server/buildingGenerator.js'

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
        server.middlewares.use('/api/building/generate', createBuildingGeneratorMiddleware(projectRoot))
        server.middlewares.use('/api/bridge/generate', createBridgeGeneratorMiddleware(projectRoot))
      },
      configurePreviewServer(server) {
        server.middlewares.use('/api/compile', createArduinoCompileMiddleware(projectRoot))
        server.middlewares.use('/api/building/generate', createBuildingGeneratorMiddleware(projectRoot))
        server.middlewares.use('/api/bridge/generate', createBridgeGeneratorMiddleware(projectRoot))
      },
    },
  ],
}))
