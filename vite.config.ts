import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import { createArduinoCompileMiddleware } from './server/arduinoCompiler.js'
import { createBridgeAiMiddleware, createBridgeAiStatusMiddleware } from './server/bridgeAi.js'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, 'GEMINI_')
  if (!process.env.GEMINI_API_KEY && env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = env.GEMINI_API_KEY
  }

  const bridgeAiMiddleware = createBridgeAiMiddleware()
  return {
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
          server.middlewares.use('/api/ai/bridge/interpret', bridgeAiMiddleware)
          server.middlewares.use('/api/ai/bridge/status', createBridgeAiStatusMiddleware())
        },
        configurePreviewServer(server) {
          server.middlewares.use('/api/compile', createArduinoCompileMiddleware(projectRoot))
          server.middlewares.use('/api/ai/bridge/interpret', bridgeAiMiddleware)
          server.middlewares.use('/api/ai/bridge/status', createBridgeAiStatusMiddleware())
        },
      },
    ],
  }
})
