import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const rootElement = document.getElementById('root')

if (!rootElement) throw new Error('No se encontró el elemento raíz de la aplicación.')

const root = createRoot(rootElement)
const standaloneBridgeDesigner = new URLSearchParams(window.location.search).has('bridge-designer')

if (standaloneBridgeDesigner) {
  const projectId = new URLSearchParams(window.location.search).get('projectId') ?? 'standalone-bridge-designer'
  const projectName = new URLSearchParams(window.location.search).get('projectName') ?? 'Proyecto de infraestructura'
  document.title = 'EMBEDVERSE BRIDGE DESIGNER'
  void import('./bridge-designer/BridgeDesigner').then(({ BridgeDesigner }) => {
    root.render(
      <StrictMode>
        <BridgeDesigner projectId={projectId} projectName={projectName} standalone />
      </StrictMode>,
    )
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'No se pudo cargar el módulo de modelado.'
    root.render(<main role="alert" style={{ padding: 24, color: '#f2b5b5', background: '#10161e' }}>{message}</main>)
  })
} else {
  void import('./App.tsx').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'No se pudo cargar EMBEDVERSE STUDIO.'
    root.render(<main role="alert" style={{ padding: 24, color: '#f2b5b5', background: '#10161e' }}>{message}</main>)
  })
}
