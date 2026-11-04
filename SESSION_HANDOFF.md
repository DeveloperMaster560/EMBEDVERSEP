# Continuidad de EMBEDVERSE STUDIO

## Objetivo del proyecto

Crear EMBEDVERSE STUDIO, una plataforma local-first para diseñar, programar, compilar y, progresivamente, simular sistemas embebidos y visualizarlos en gemelos digitales 3D. El catálogo debe poder escalar a miles de componentes sin afirmar que un elemento es funcional si solo tiene representación o metadatos. Cada nivel —visual, configurable, simulación funcional, ejecución de firmware y física avanzada— debe mantenerse explícito.

## Ubicación y ejecución

- Workspace del proyecto: `C:\Users\PC\Downloads\Desarrolo`.
- Aplicación: React, TypeScript, Vite; proyectos guardados en IndexedDB del navegador.
- Puerto Vite fijado en `5174` (`strictPort: true`) porque `5173` lo ocupa otra app/proyecto. No liberar ni terminar procesos del otro proyecto.
- Inicio en PowerShell:

  ```powershell
  Set-Location C:\Users\PC\Downloads\Desarrolo
  npm run dev
  ```

- No confundir con el otro proyecto del usuario: `C:\Users\PC\Downloads\0_3-Desarrollo-modernizado\0_3-Desarrollo-modernizado`.

## Trabajo implementado

- Dashboard local, gestión de proyectos, editor Monaco y catálogo descriptivo inicial.
- Integración local de compilación con Arduino CLI 1.5.1 y core AVR 1.8.8. Los binarios y cores se guardan bajo `.tools/` y están excluidos de Git.
- Botón **Compilar** para Arduino Uno conectado a la API de desarrollo Vite: compila realmente y presenta descarga del firmware `.hex`. La API valida placa, rutas, tipos de archivo, tamaño, origen, duración y salida; ejecuta CLI sin shell y limpia directorios temporales.
- ESP32 aún no tiene core integrado. La compilación no ejecuta el firmware ni lo flashea a una placa.
- Visor 3D Three.js bajo demanda: genera un puente de referencia ilustrativo o importa GLB, glTF, OBJ y STL. Persiste modelo y recursos en IndexedDB. No calcula física estructural ni sincroniza nodos todavía.
- EMBEDVERSE BRIDGE DESIGNER independiente en `src\bridge-designer\`, integrado desde la pestaña Modelos 3D; ver `DEVELOPMENT_STATUS.md`, `INTEGRATION_GUIDE.md` y `TEST_REPORT.md`.
- EMBEDVERSE ELECTRONICS LAB reemplazó el antiguo SVG estático: `src\electronics-lab\ElectronicsLab.tsx` y `electronics-lab.css` implementan un editor interactivo SVG, componentes vectoriales de referencia, propiedades, selección, movimiento, rotación, duplicar/eliminar, undo/redo, zoom, modo de montaje/esquemático y cables entre pines que siguen a los componentes.
- El modelo de circuito tipado está en `src\domain\types.ts`; `src\domain\circuit.ts` mantiene pinouts Uno/ESP32/MPU6050 y componentes pasivos, creación/migración de la práctica, remapeo de pines al cambiar la placa y validación estructural. El ejemplo es un sistema de monitoreo de vibraciones de referencia basado en MPU6050. Las conexiones se guardan en el proyecto principal IndexedDB mediante autoguardado.
- La validación no es simulación eléctrica. No hay motor SPICE, simulación de firmware, protoboard, instrumentos reales, telemetría ni validación de seguridad. El botón Simular está deshabilitado. La vista esquemática es una proyección básica del mismo circuito, no un EDA completo. Los dibujos son aproximados, no activos oficiales.
- Documentación del laboratorio: `COMPONENT_LIBRARY.md`, `SIMULATION_COMPATIBILITY.md`, además de actualizaciones en `README.md`, `ARCHITECTURE.md`, `INTEGRATION_GUIDE.md`, `DEVELOPMENT_STATUS.md`, `COMPONENT_CATALOG.md` y `TEST_REPORT.md`.
- Hay script de preparación del compilador AVR: `scripts\setup-arduino.ps1`.
- Arquitectura, decisiones, roadmap, estado, motor de simulación y catálogo están documentados en Markdown en la raíz.

## Limitaciones importantes

- La API de compilación está diseñada para Vite local `dev`/`preview`. No exponerla a la red ni usarla con código no confiable; todavía carece de sandbox del SO y cuota de memoria del proceso.
- Electronics Lab tiene conectividad lógica por pines, pero aún no implementa validación eléctrica cuantitativa, ruteo editable del cable, selección múltiple, paneo, protoboard ni simulación.
- No están implementados ejecución de firmware en simulador, modelos de comportamiento de sensores, comunicaciones, nodos 3D sincronizados ni análisis estructural.
- El puente generado solo ilustra geometría.
- ESP32 no puede compilarse todavía en esta aplicación.

## Última verificación registrada

- `npm test -- --run`: 25 pruebas correctas (9 archivos), incluyendo editor/circuito, persistencia, compilación Arduino, geometría del puente y serialización.
- `npm run build`: correcto. Vite advierte que el chunk de Three.js/OrbitControls supera 500 kB sin gzip (~664 kB; ~166 kB comprimido).
- `npm run lint`: correcto.
- El servidor local del workspace respondió HTTP 200 en `http://localhost:5174/`; el módulo Electronics Lab también respondió correctamente.

## Próximos pasos recomendados

1. Abrir `http://localhost:5174/`, entrar en un proyecto → **Sistema embebido**; probar manualmente agregar/mover/rotar componentes, conectar y eliminar cables, alternar modos, guardar/reabrir.
2. Corregir cualquier problema de interacción del editor observado en el navegador; verificar persistencia real de circuito guardado.
3. Próxima mejora funcional de Electronics Lab: paneo/selección múltiple y edición de rutas de cables, seguida de una protoboard con modelo de continuidad.
4. Diseñar y probar la biblioteca declarativa de componentes y reglas eléctricas con fuentes de referencia antes de añadir más componentes.
5. Evaluar motores de simulación reales por placa/periféricos; no etiquetar compilación ni animación visual como simulación.
6. Abrir **Modelos 3D**, comprobar creación/importación. No afirmar prueba manual de WebGL sin realizarla.

Este archivo conserva contexto y estado del trabajo; no es una transcripción literal de todos los mensajes.
