# Auditoría de licencias

Auditoría de las dependencias directas instaladas en EMBEDVERSE STUDIO el 3 de noviembre de 2026. El Bridge Designer reutiliza Three.js y no incorpora paquetes nuevos. Los identificadores se leyeron de los `package.json` instalados; revisar también las licencias incluidas por cada paquete antes de redistribuir artefactos.

| Dependencia directa | Versión instalada | Licencia declarada | Uso relevante |
|---|---:|---|---|
| `three` | 0.187.0 | MIT | Motor WebGL, controles, loaders y exportador 3D |
| `react` | 19.3.1 | MIT | Interfaz |
| `react-dom` | 19.3.1 | MIT | Renderizado DOM |
| `@monaco-editor/react` | 4.7.0 | MIT | Editor de firmware existente |
| `lucide-react` | 1.67.0 | ISC | Iconografía |
| `vite` | 8.3.5 | MIT | Desarrollo y build |
| `@vitejs/plugin-react` | 6.2.1 | MIT | Integración React/Vite |
| `typescript` | 7.0.2 | Apache-2.0 | Tipado y build |
| `vitest` | 5.1.0 | MIT | Pruebas |
| `fake-indexeddb` | 6.2.7 | Apache-2.0 | Pruebas de persistencia |
| `oxlint` | 1.91.0 | MIT | Lint |
| `@types/node` | 24.19.2 | MIT | Tipos |
| `@types/react` | 19.3.0 | MIT | Tipos |
| `@types/react-dom` | 19.3.0 | MIT | Tipos |
| `@types/three` | 0.187.0 | MIT | Tipos Three.js |

Las versiones instaladas pueden diferir de los rangos del manifiesto. Este documento cubre dependencias directas, no un inventario legal completo de dependencias transitivas. No se detectaron dependencias de pago ni se añadió ninguna licencia propietaria.
