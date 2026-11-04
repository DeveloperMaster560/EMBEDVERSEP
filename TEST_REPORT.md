# Informe de pruebas — Bridge Designer

## Electronics Lab

- Pruebas automatizadas del circuito de monitoreo base para pinouts Uno y ESP32, detección de conexiones I²C faltantes, validación de IDs de pines inválidos, cambio de placa con remapeo y migración del circuito SVG anterior.
- Validación con `npm run lint`, `npm test -- --run` y `npm run build`.
- Última suite completa: 25 pruebas en 9 archivos correctas; lint correcto y build correcto.
- No se afirma prueba manual de drag/cableado en navegador ni prueba eléctrica/SPICE. No existe simulador integrado.

## Alcance de implementación

- Scene builder: tipologías parametrizadas, dimensiones/unidades, componentes estructurales como objetos editables.
- Editor Three.js: órbita, zoom, desplazamiento, selección, manipulador mover/rotar/escalar y vistas.
- Inspector: árbol por colecciones, visibilidad/bloqueo, transformaciones numéricas, dimensiones y material.
- Import/export: GLB, glTF (con dependencias seleccionadas juntas), OBJ, STL; exportación GLB y archivo `.evbridge`.
- Persistencia: guardado automático IndexedDB propio y recuperación por `projectId`.
- IoT: nodos ESP32/MPU6050 y asociaciones locales sin conectividad real.

## Comprobaciones ejecutadas

La suite automatizada de `npm test` cubre generación estructural cable-stayed, arch, truss y suspensión, validación de parámetros, conversión de unidades, asociaciones de sensores, serialización `.evbridge` y aislamiento de proyectos en IndexedDB.

`npm run lint` y `npm run build` verifican el código. Las pruebas unitarias no automatizan interacción real de WebGL, drag de TransformControls, ni importación desde archivos de navegador. No se afirma que esas pruebas manuales estén completadas.

## Limitaciones verificadas

- No hay análisis estructural, elementos finitos, cumplimiento normativo, ni planos de construcción.
- La geometría importada puede transformarse y cambiar material, pero no editar topología; texturas y formatos de material complejos no se conservan al aplanar mallas.
- Telemetría y conectividad de ESP32/sensores no implementadas.
- Sin agrupamiento jerárquico 3D nativo: las colecciones agrupan por atributo serializado.
- Sin cámara ortográfica, timeline, configuración de iluminación en UI, exportación OBJ/STL ni medición entre dos puntos.
- GLTF/OBJ grandes se parsean en el hilo principal; límite de importación 30 MiB/1 millón de vértices.
- Three.js y controles generan un chunk superior a 500 kB minificado.
