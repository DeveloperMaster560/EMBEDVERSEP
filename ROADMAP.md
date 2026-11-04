# Roadmap

| Fase | Entrega | Estado |
|---|---|---|
| 0. Auditoría | Inventario del entorno, arquitectura, riesgos y decisiones | Completa |
| 1. Núcleo | Proyectos locales, editor, configuración de placa y catálogo inicial | En progreso |
| 2. Electronic Lab | Modelo de circuito y conexiones eléctricas verificables | Pendiente |
| 3. Compilación | Adaptador Arduino CLI/PlatformIO y compilación real | En progreso: botón/UI/API y descarga HEX para Uno; pendiente empaquetado y soporte ESP32 |
| 4. Simulación | Adaptador inicial con compatibilidad y fidelidad declaradas | Pendiente; motores no instalados |
| 5. Componentes | Ampliación del catálogo y modelos de comportamiento probados | Pendiente |
| 6. Gemelo 3D | Importación GLB/glTF, nodos y asociación con datos | En progreso: módulo Bridge Designer, puentes paramétricos, manipulación Three.js, import/export y persistencia propia; integración de telemetría/análisis pendientes |
| 7. Comunicaciones | Adaptadores de buses y red entre nodos | Pendiente |
| 8. Testing | Escenarios, analítica e informes identificados como simulados o medidos | Pendiente |
| 9. Interoperabilidad | Formato `.evs`, importación/exportación con reporte de compatibilidad | Pendiente |
| 10. Estabilización | Integración, rendimiento, seguridad y documentación | Pendiente |

## Asistente de diseño estructural (preparación)

- Contrato versionado e independiente del proveedor para solicitudes y propuestas conceptuales en `src/structural-ai/contracts.ts`.
- Puentes y catedrales son el primer alcance; el modelo acepta futuras familias sin restringir el esquema.
- Integración de proveedor, corpus curado con fuentes/licencias, ingestión de planos, generación y validación de ingeniería siguen pendientes. Véase `STRUCTURAL_AI.md`.

## Próximo incremento

Recibir e inventariar los documentos de referencia; definir el proceso de extracción y evaluación con profesionales antes de conectar un proveedor o generar estructuras nuevas.
