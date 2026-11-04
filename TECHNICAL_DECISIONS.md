# Decisiones técnicas

## ADR-001: aplicación web local-first

- **Decisión:** React 19 + TypeScript + Vite para el cliente; IndexedDB para proyectos de la Fase 1.
- **Motivo:** disponibilidad inmediata de Node 24/npm y desarrollo rápido de editor y visualización; no hay necesidad de toolchain nativa para el núcleo.
- **Consecuencia:** los proyectos viven en el perfil del navegador y aún no son archivos portables `.evs`. Se añadirá una capa de host nativo si los procesos y el acceso al sistema de archivos lo requieren.

## ADR-002: editor Monaco

- **Decisión:** `@monaco-editor/react` para edición multiarchivo en navegador.
- **Motivo:** editor de código dedicado con resaltado, navegación de líneas y configuración adaptable.
- **Seguridad:** se fijó una resolución de `dompurify` >= 3.4.17 mediante `overrides` después de que npm audit detectara vulnerabilidades en la versión transitiva inicial.

## ADR-003: Three.js para visor 3D

- **Decisión:** usar Three.js cargado bajo demanda al abrir el gemelo 3D; soportar GLB/glTF/OBJ/STL y generar una geometría ilustrativa local.
- **Motivo:** permite visualizar modelos sin cargar el bundle 3D en la vista inicial. Three.js publica licencia MIT.
- **Límite:** no hay vínculo de nodos, dinámica física ni carga remota de assets.

## ADR-004: niveles de soporte explícitos

- **Decisión:** cada componente informa un estado de implementación; los elementos actuales son solo visuales.
- **Motivo:** evitar confundir representación, parámetros configurables, simulación funcional, ejecución de firmware y física avanzada.

## ADR-005: compilación local con Arduino CLI

- **Decisión:** exponer un endpoint solo en Vite `dev`/`preview` para compilar Arduino Uno usando el toolchain local; la UI descarga el Intel HEX producido. ESP32 se rechaza explícitamente hasta instalar su core.
- **Seguridad:** invocar CLI sin shell, aceptar solo placas/extensiones conocidas, validar rutas, limitar tamaño/archivos/tiempo/salida, exigir origen local y borrar staging temporal. No es sandbox del SO y no debe publicarse en redes.
- **Distribución:** `scripts/setup-arduino.ps1` instala Arduino CLI 1.5.1 tras verificar SHA-256 oficial, junto con el core AVR; los archivos `.tools/` se excluyen del control de versiones.

## ADR-006: visualización de gemelo local

- **Decisión:** Three.js, generación de un puente de referencia e importación local GLB/glTF/OBJ/STL. Los modelos y archivos auxiliares se guardan en IndexedDB y no se suben a terceros.
- **Límites:** máximo 50 MiB y 200 archivos; glTF debe incluir sus buffers/texturas externos en la selección. OBJ/ STL se importan como geometría; el visor no implementa nodos sincronizados ni análisis estructural.
