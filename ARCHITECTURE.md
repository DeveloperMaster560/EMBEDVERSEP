# Arquitectura de EMBEDVERSE STUDIO

## Decisión inicial

La Fase 1 es una aplicación web local-first, desarrollada como SPA con React, TypeScript y Vite. Permite ejecutar y actualizar la interfaz sin instalar toolchains embebidas. La persistencia inicial usa IndexedDB en el navegador; no se envían proyectos a un servidor. Se pospone empaquetar la aplicación como escritorio hasta que la integración de sistema de archivos y procesos nativos sea necesaria.

## Capas

```text
Interfaz React
  ├─ Dashboard, proyectos, editor Monaco y catálogo descriptivo
  ├─ Dominio: proyectos, placas y definiciones tipadas de componentes
  └─ Persistencia: repositorio IndexedDB

Futuro host de escritorio (decisión pendiente: Electron o Tauri)
  ├─ API mínima mediante IPC / bridge validado
  ├─ procesos de compilación y simulación aislados
  └─ adaptadores de toolchains, simuladores e importadores 3D
```

La UI no ejecuta firmware. En desarrollo/previsualización local, una API de Vite ejecuta el compilador AVR con `spawn` sin shell, una lista fija de placas y archivos, rutas normalizadas, límite de archivos, tiempo de compilación y salida acotada. Los binarios se generan en un directorio temporal controlado y el firmware HEX se devuelve al navegador para descargarlo.

Esta API es local de desarrollo, no un servicio para publicar en red. Aunque valida origen y limita entradas y duración, todavía no usa un sandbox del sistema operativo ni impone una cuota de memoria al proceso compilador; no debe compilar proyectos no confiables en un servidor compartido.

El visor 3D usa Three.js en un chunk que se carga al abrir el espacio gemelo. Las escenas importadas y recursos asociados se conservan como ArrayBuffers en el proyecto de IndexedDB. El generador de puente es geometría ilustrativa, sin cálculo físico.

## Estructura actual

- `src/domain/`: tipos de proyecto y catálogo.
- `src/electronics-lab/`: editor visual/SVG y estilos del Electronics Lab.
- `src/domain/circuit.ts`: pines de referencia, circuito inicial, conversión de placa y validación estructural de conexiones.
- `src/storage/`: repositorio local de proyectos.
- `src/App.tsx`: navegación y vistas de la Fase 1.
- `src/App.css`, `src/index.css`: tema y layout.
- `ARCHITECTURE.md`, `ROADMAP.md`, `COMPONENT_CATALOG.md`, `SIMULATION_ENGINE.md`, `TECHNICAL_DECISIONS.md`, `DEVELOPMENT_STATUS.md`: diseño, límites y estado.

## Persistencia y modelo

Un proyecto guarda un identificador, nombre, placa objetivo, descripción, archivos editables y marcas de tiempo. IndexedDB almacena el documento completo por ID. La estructura de componentes (`ComponentDefinition`) separa interfaces, pines, voltaje, compatibilidad e implementación. El modelo del laboratorio (`ElectronicCircuit`) separa componentes colocados de conexiones pin-a-pin y se guarda como parte del proyecto en IndexedDB. El dibujo de montaje y el dibujo esquemático consumen el mismo DTO; los terminales lógicos están enumerados por `getCircuitPins`. El render SVG no hace cálculos eléctricos. La validación informa de referencias inválidas y terminales obligatorios no conectados, sin validar corrientes/tensiones ni seguridad.

### EMBEDVERSE ELECTRONICS LAB

`src/electronics-lab/ElectronicsLab.tsx` coordina herramientas, viewport SVG, inspector, historial y panel de validación. `src/domain/circuit.ts` mantiene el modelo de pinout y validación fuera de la vista. Los cables almacenan IDs de componentes y pines; su ruta se vuelve a calcular desde las transformaciones y por ello permanece anclada al mover o rotar un componente. El autoguardado del proyecto principal persiste el DTO, no nodos SVG.

El modo esquemático es una segunda proyección de la misma escena, no un documento eléctrico separado. Por ahora no modela uniones intermedias, nombres de red ni hojas. No hay motor de simulación ni datos simulados. La interfaz solo declara interoperabilidad futura con el Embedded IDE.

## Seguridad y evolución

- El contenido de firmware es texto; no se ejecuta dentro del proceso web.
- Las importaciones y la ejecución de procesos nativos aún no están implementadas.
- Un host Electron futuro requerirá `contextIsolation`, `sandbox`, `nodeIntegration: false`, preload mínimo y contenido local confiable. Los procesos de simulación no tendrán acceso general al host.
- Los proyectos son locales al perfil del navegador; no constituyen una estrategia de copia de seguridad ni multiusuario.
- La arquitectura permite sustituir IndexedDB por SQLite detrás del repositorio cuando exista un host de escritorio.

## EMBEDVERSE BRIDGE DESIGNER (módulo aislado)

`src/bridge-designer/` es un módulo React/TypeScript aislado del estado de navegación y del dominio del firmware:

```text
BridgeDesigner.tsx       Interacción, inspector, herramientas, importación/exportación
BridgeViewport.tsx       Escena Three.js, cámara, picking, OrbitControls y TransformControls
scene.ts                 Modelo serializable, primitivas y generador paramétrico de puentes
serialization.ts         Validación de documentos .evbridge
persistence.ts           Repositorio IndexedDB propio (embedverse-bridge-designer)
types.ts                 Contrato de escena, objetos, materiales y asociaciones IoT
bridge-designer.css      Estilos encapsulados del editor
```

El módulo puede montarse desde el workspace con `projectId` y `projectName` o en modo independiente mediante `?bridge-designer=1&projectId=...&projectName=...`. Mantiene su escena en una base propia, separada de `embedverse-studio`; no modifica el esquema de proyectos existente. El contrato de datos es `BridgeSceneDocument` y el documento exportado usa el esquema versionado `.evbridge`.

Los objetos paramétricos se serializan como definiciones geométricas, dimensiones, transformación, material y colección. Las mallas importadas se almacenan como arrays de vértices/índices dentro del documento local (límite de 1 millón de vértices por importación); no se conserva el archivo original ni una topología editable. El acceso a las escenas Three.js está encapsulado en `BridgeViewport`; UI y dominio operan sobre DTOs, no sobre objetos `Mesh`.

El generador produce elementos geométricos separados y ajustados a parámetros de tablero, apoyos, vanos y carriles. Las formas son visuales y paramétricas; no constituyen diseño calculado, modelo de elementos finitos, plano constructivo ni verificación normativa. Los campos `deviceId`, `sensorId`, `bridgeComponentId` y las transformaciones preparan asociaciones persistentes, sin MQTT, telemetría ni conexión de hardware.

Three.js y sus addons (`OrbitControls`, `TransformControls`, loaders y `GLTFExporter`) son reutilizados; no se añadió dependencia. La carga del módulo se hace con `import()` para no incorporar el editor al bundle inicial del dashboard.
