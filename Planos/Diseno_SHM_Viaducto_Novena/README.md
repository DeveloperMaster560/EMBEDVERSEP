# Paquete de diseño preliminar SHM — Viaducto de La Novena

Este directorio contiene la propuesta de instrumentación física, estructural,
electrónica y eléctrica para un sistema SHM adaptable al Viaducto de La Novena.
Es un diseño preliminar de ingeniería: no sustituye el levantamiento geométrico,
la inspección de la estructura, el análisis modal ni los diseños constructivos
firmados que se requieren antes de instalar equipos en un puente en servicio.

## Alcance y documentos

- `diseno_tecnico.md`: bases, arquitectura, ubicación paramétrica, componentes,
  montaje, adquisición, energía, comunicaciones, instalación, pruebas y riesgos.
- `interfaces_y_conexiones.md`: conexiones de referencia, interfaces y datos
  que se entregan al equipo de software. Los pines finales del PCB quedan sujetos
  al esquemático y a la placa de adquisición que se seleccione.
- `bom_preliminar.csv`: lista preliminar de materiales con cantidades por estación
  expresadas como configuración base y elementos opcionales separados.
- `diagramas.md`: diagramas de arquitectura, estación y trazado espacial
  paramétrico.

## Matriz de entregables

| Entregable solicitado | Ubicación |
|---|---|
| Arquitectura física integral y por estación | `diseno_tecnico.md`, `diagramas.md` |
| Estrategia estructural y plano paramétrico de sensores | `diseno_tecnico.md` §4, `diagramas.md` §4 |
| Sensores, nodos, conexiones, pinout y cableado | `diseno_tecnico.md` §5–7, `interfaces_y_conexiones.md` §2–5 |
| BOM por estación y general paramétrica | `bom_preliminar.csv` |
| Alimentación y cálculo solar/autonomía | `diseno_tecnico.md` §8 |
| Comunicaciones, sincronización y adquisición | `diseno_tecnico.md` §9–10 |
| Datos de integración, almacenamiento y estados | `interfaces_y_conexiones.md` §6–8 |
| Instalación, calibración, mantenimiento y aceptación | `diseno_tecnico.md` §12–13 |
| Alarmas, hipótesis, riesgos, normativa y fuentes | `diseno_tecnico.md` §11, §14–16 |

## Estado

La arquitectura existente documentada es un prototipo de dos ESP32 con MPU6050,
publicación MQTT, recepción en Node-RED y almacenamiento en InfluxDB, con
servicios reportados en AWS/EC2. La carpeta también contiene firmware distinto
entre nodos y versiones. Ese prototipo es una referencia de integración y no se
considera instrumentación de precisión para análisis modal ni evidencia de
condición estructural.

Los datos del viaducto no disponibles en la carpeta se marcan como pendientes
de campo. La ubicación final, número de estaciones, rangos y frecuencias de
muestreo se cerrarán con planos, inspección, análisis modal y estudio de ruido.
