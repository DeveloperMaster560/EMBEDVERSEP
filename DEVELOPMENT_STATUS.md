# Estado de desarrollo

**Versión:** 0.1.0 · **Fecha de auditoría:** 2026-11-03

## Entorno

- Windows; directorio de trabajo inicialmente vacío, sin proyecto previo que preservar.
- Node.js 24.19.0, npm 11.17.0, pnpm 11.7.0.
- Python 3.14.5, host `dotnet` localizado sin SDK listado, Java 24, Docker 29.4.3, WSL 2.
- Arduino CLI, PlatformIO, AVR GCC, Renode, QEMU AVR, Rust/Cargo y toolchains C/C++ no estaban preinstalados.

## Implementado en Fase 1

- Aplicación React/TypeScript/Vite con tema oscuro adaptable.
- Crear, abrir, listar, editar y eliminar proyectos locales; persistencia IndexedDB y guardado automático/manual.
- Selección de Arduino Uno R3 o ESP32 DevKit como configuración de proyecto.
- Editor Monaco, explorador multiarchivo y consola con estado real de toolchain (sin compilación ficticia).
- Catálogo tipado de siete componentes, búsqueda y filtros; cada componente está marcado solo visual.
- Documentación de arquitectura, catálogo, simulación, decisiones y roadmap.

## Integraciones en curso

- **Compilación:** botón Compilar conectado a una API local de Vite que ejecuta Arduino CLI sin shell, valida rutas/tipos/tamaño, limita salida y duración y limpia archivos temporales. Arduino Uno genera firmware `.hex` descargable. ESP32 devuelve claramente que su core no está configurado. No se flashea hardware ni se ejecuta simulación.
- **Visor 3D:** geometría ilustrativa de puente generada, orbit/zoom/pan y carga de GLB, glTF, OBJ y STL. Se admiten recursos auxiliares glTF seleccionados juntos. Los archivos se guardan en IndexedDB con el proyecto; importación limitada a 50 MiB.
- El host de compilación solo está integrado para Vite `dev` y `preview`; la compilación no debe exponerse a una red pública. El proceso tiene timeout y límites de entradas/salida, pero todavía no cuenta con sandbox OS ni límite de memoria.

## Pendiente

Faltan simulación eléctrica/firmware, validación eléctrica cuantitativa, protoboard, edición de recorridos de cable, instrumentos conectados a datos, importación/exportación `.evcircuit`, sincronización IDE/3D, comunicaciones, informes, plugins, importación/exportación `.evs`, nube y colaboración. Arduino CLI 1.5.1 y core AVR 1.8.8 están en `.tools/` y excluidos de Git. `examples/arduino-blink/arduino-blink.ino` compiló realmente para `arduino:avr:uno` y generó ELF/HEX. ESP32 aún no tiene core ni compilador instalado.

## EMBEDVERSE ELECTRONICS LAB — editor interactivo inicial

- Auditoría: la vista anterior dibujaba un SVG estático y `validateCircuit` esperaba una secuencia fija de IDs; no había edición ni pines/cables.
- El módulo `src/electronics-lab/` proporciona biblioteca de componentes, montaje SVG interactivo, modo de símbolos esquemáticos, selección/arrastre, rotación, duplicación/eliminación, cableado entre terminales y cables que siguen transformaciones.
- Modelo compartido de componentes/conexiones persiste como parte del proyecto IndexedDB existente. Autoguardado existente actualiza los cambios; se agrega undo/redo local de hasta 30 operaciones.
- Caso de referencia: sistema de monitoreo con MPU6050, alimentación 3.3V, GND, SDA/SCL seleccionados según la placa, condensador representativo y LED con resistencia. Los gráficos son dibujos vectoriales aproximados, no activos oficiales.
- La validación solo detecta referencias a pines inválidos, extremos huérfanos y conexiones faltantes en terminales requeridos. No es un comprobador eléctrico ni certifica seguridad.
- Sin ejecución SPICE, simulación de firmware, protoboard con continuidad, mediciones, osciloscopio activo o monitor serial. El control de simulación está deshabilitado y comunica esta limitación.
- Pendientes UI: zoom disponible; aún faltan paneo, selección múltiple y edición de puntos de ruta. El modo esquemático comparte el circuito, pero es una representación inicial y no un editor EDA de hojas/redes completo.
- Verificación actual de la suite completa: 25 pruebas aprobadas; lint y build correctos. La advertencia del bundle Three.js pertenece al Bridge Designer y permanece.

## Riesgos y mitigaciones

- **Ejecución de código:** compilar firmware no lo ejecuta ni lo flashea. El proceso local tiene timeout y entrada limitada, pero aún no está aislado por sandbox del SO y no debe recibir proyectos no confiables ni exponerse en red.
- **Fidelidad de simulación:** documentar capacidades por placa/periférico y probar cada adaptador.
- **Portabilidad:** IndexedDB es local; exportación `.evs` permanece pendiente.
- **Datos físicos:** la biblioteca es descriptiva y no certifica compatibilidad eléctrica.

## Verificación

- La verificación más reciente del workspace principal: `npm test` con 13 pruebas, `npm run lint` y `npm run build` correctos antes de Bridge Designer.
- `npm audit`: 0 vulnerabilidades.
- Endpoint de desarrollo: Arduino Uno compiló y devolvió el HEX descargable; orígenes externos rechazados.
- El bundle 3D de Three.js es de ~662 kB sin gzip (~166 kB gzip); Vite señala que supera 500 kB y requiere optimización adicional.

## Rediseño del workspace y entorno integrado (2026-11-03)

### Diagnóstico de la base actual

- Stack frontend: React + TypeScript + Vite + Monaco editor + Three.js + lucide-react.
- Backend actual: únicamente API local de Vite para compilación Arduino, sin servidor Express independiente.
- Estructura principal: aplicación monolítica en `src/App.tsx`, repositorio local en `src/storage/projectRepository.ts`, modelos 3D en `src/components/DigitalTwinViewer.tsx` y `src/3d/bridgeModel.ts`, catálogo en `src/domain/catalog.ts`.
- Proyectos: persistidos en IndexedDB con guardado automático y guardado manual.
- Botón 3D: existente y operativo, pero centrado en visualización/puente ilustrativo; no es un modelador completo.
- Visor 3D: sí existe, basado en Three.js con OrbitControls y carga de GLB/glTF/OBJ/STL.
- Bibliotecas gráficas: `three`, `@monaco-editor/react`, React 19 y Vite.
- Componentes reutilizables: `EditorPage`, `DigitalTwinPage`, `ElectronicLabPage`, `Dashboard`, `ProjectsPage`, `ComponentsPage` y repositorio de proyecto.

### Qué se conserva

- La persistencia local de proyectos en IndexedDB.
- El editor Monaco para firmware.
- El visor 3D y la carga real de modelos importados.
- La API local de compilación Arduino Uno y el flujo de descarga HEX.
- El catálogo y la base visual del entorno.

### Qué se modifica

- Se reorganiza el flujo de trabajo alrededor de un único espacio de proyecto con pestañas de ingeniería: Resumen, Código, Sistema embebido, Modelos 3D, Simulación, Pruebas y Ajustes.
- La apertura de un proyecto ya no fuerza una vista aislada; ahora se mantiene un entorno integrado.
- Se incorpora un laboratorio electrónico con validación básica de circuito.
- Se añade una vista de resumen del proyecto y paneles de control de configuración.

### Funcionalidades operativas

- Navegación superior de proyecto con áreas de trabajo.
- Resumen de proyecto con microcontrolador, componentes, archivos, estado de compilación y modelo 3D.
- Editor de código con explorador, consola y compilación real para Arduino Uno.
- Laboratorio electrónico con montaje editable y conexiones por pines; detalles y limitaciones en el estado Electronics Lab más abajo.
- Modelador independiente EMBEDVERSE BRIDGE DESIGNER integrado en Modelos 3D y accesible por `?bridge-designer=1`.
- Persistencia local separada del módulo 3D, con clave común `projectId`; el módulo principal y la escena 3D no comparten una transacción IndexedDB.
- Cambio de placa desde ajustes del proyecto.

### Pendientes reales

- Motor de simulación funcional no integrado aún.
- Bridge Designer: sin cámara ortográfica, paneles redimensionables, timeline, edición topológica, exportadores OBJ/STL ni medición punto a punto.
- Asociación de nodos 3D a objetos de escena soportada localmente; enlace con componentes electrónicos del proyecto principal y telemetría real pendientes.
- La escena importada se aplana a mallas; materiales/texturas complejos no se conservan.
- Los modelos grandes se importan en el hilo principal; máximo 30 MiB y 1 millón de vértices.
- Análisis estructural, validación normativa y planos constructivos no implementados.

### Riesgos y advertencias

- Los bundles de Three.js y OrbitControls exceden 500 kB minificados (OrbitControls: ~664 kB; ~166 kB gzip); el editor se carga diferido.
- La simulación todavía se documenta como no ejecutable; se prevé para una fase posterior.

## EMBEDVERSE BRIDGE DESIGNER — primera entrega (2026-11-03)

- Auditoría previa confirmada: React 19, TypeScript, Vite, Three.js y Monaco; solo hay middleware de compilación en Vite, no backend independiente. El visor previo era de visualización/importación y no incluía manipulación. No se añadió paquete nuevo.
- Módulo aislado en `src/bridge-designer/`: vista Three.js separada, escena serializable, repositorio IndexedDB propio, validador `.evbridge` y guía de integración.
- Operaciones incluidas: 10 tipologías de puente con geometría estructural separada y parámetros, primitivas, selección, mover/rotar/escalar con TransformControls, campos numéricos, duplicar/eliminar, jerarquía por colecciones, visibilidad/bloqueo, materiales básicos, unidades métricas, vistas de cámara, importación GLB/glTF/OBJ/STL, exportación GLB y `.evbridge`, guardado automático.
- Nodos ESP32/MPU6050 y asociaciones persistentes con elementos estructurales preparados; estado explícito sin conexión y sin telemetría simulada.
- Modo integrado en Modelos 3D y modo independiente por query string; el gemelo previo se conserva en el código para evitar eliminar su flujo existente.
- Documentación añadida/actualizada: `ARCHITECTURE.md`, `README.md`, `LICENSE_AUDIT.md`, `INTEGRATION_GUIDE.md`, `TEST_REPORT.md`.
- Verificación Bridge Designer: 22 pruebas totales correctas; lint y build correctos. Vite mantiene advertencia por chunk Three.js >500 kB.
- No se automatizó WebGL en navegador en esta sesión; consultar `TEST_REPORT.md` para separar cobertura unitaria de pruebas manuales pendientes.

## Preparación del asistente de diseño estructural (2026-11-04)

- Contrato TypeScript independiente del proveedor para solicitudes y propuestas conceptuales, extensible más allá de puentes y catedrales: `src/structural-ai/contracts.ts`.
- Parámetros de documentos requieren referencia; las propuestas reservan procedencia, supuestos, preguntas, citas y limitaciones.
- Pruebas unitarias del contrato añadidas. No hay proveedor de IA, RAG, documentos de referencia ni generación de catedrales conectados.
- Diseño de flujo, curación de fuentes, evaluación y límites de uso documentados en `STRUCTURAL_AI.md`.
