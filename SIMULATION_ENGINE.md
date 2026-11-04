# Evaluación del motor de simulación

## Inventario del entorno (Windows)

La auditoría inicial no detectó toolchains. Después se descargó la versión estable oficial Arduino CLI 1.5.1 y se verificó su SHA-256 antes de instalarla en `.tools/` (excluido de Git). Se instaló el core `arduino:avr` 1.8.8 en la misma ubicación; no se modificó la instalación global del equipo. Arduino Uno ya tiene compilador disponible en este workspace. Esto todavía no conecta el compilador a la interfaz.

## Candidatos y compatibilidad inicial

| Tecnología | Estado/licencia | Uso potencial y límites |
|---|---|---|
| Renode | No instalado; repositorio oficial declara licencia MIT (las dependencias conservan sus licencias). | Candidato para plataformas/periféricos modelados por Renode; verificar soporte concreto de placa, MCU y periféricos antes de prometer ejecución. |
| QEMU | No instalado; COPYING del repositorio declara GPL-2.0. | La disponibilidad de targets y periféricos es específica por arquitectura; no asumir soporte general de AVR o ESP32. Revisar obligaciones de distribución antes de empaquetarlo. |
| simavr | No instalado; COPYING del repositorio declara GPL-3.0. | Candidato acotado a familias AVR compatibles; revisar obligaciones de distribución y validar firmware/modelo de placa exactos. |
| AVR8js | No instalado ni integrado; licencia MIT. | Mejor candidato de prueba temprana para AVR en un host web/JS: solo implementa el núcleo CPU, requiere código máquina previamente compilado y la aplicación debe implementar periféricos externos. No es un simulador integral por sí solo. |
| Wokwi | No integrado. | No se usará una API privada ni se afirmará compatibilidad sin interfaz oficial autorizada. |
| Modelos propios | No implementados. | Pueden cubrir dispositivos individuales a nivel funcional, con alcance y límites documentados por modelo. |

## Compatibilidad inicial

| Placa | Seleccionable en proyectos | Compilador disponible | Ejecución verificada |
|---|---:|---:|---:|
| Arduino Uno R3 / ATmega328P | Sí, como metadato | Sí: Arduino CLI/core AVR locales | Compilación real y `.hex` disponibles; CPU/periféricos aún sin simulador integrado |
| ESP32 DevKit / ESP32-WROOM-32 | Sí, como metadato | No (`arduino-cli` y PlatformIO ausentes) | No; no se ha verificado un adaptador y modelo compatible |

El siguiente spike de firmware evaluará AVR8js con el binario AVR ya compilado, incorporando además placa y periféricos. Renode queda como candidato sujeto a confirmar el modelo exacto. No se asigna nivel 2 a ninguna placa actualmente.

Referencias consultadas: [licencia de Renode](https://github.com/renode/renode/blob/master/LICENSE), [QEMU COPYING](https://github.com/qemu/qemu/blob/master/COPYING), [simavr COPYING](https://github.com/buserror/simavr/blob/master/COPYING), [AVR8js README](https://github.com/wokwi/avr8js/blob/main/README.md), [AVR8js licencia](https://github.com/wokwi/avr8js/blob/main/LICENSE), [documentación de seguridad de Electron](https://www.electronjs.org/docs/latest/tutorial/security) y [licencia de Three.js](https://github.com/mrdoob/three.js/blob/dev/LICENSE). La licencia de una herramienta no acredita compatibilidad del microcontrolador ni de los periféricos.

## Niveles de fidelidad

La Fase 1 no implementa ninguno: el catálogo solo representa información. El adaptador futuro deberá declarar si entrega modelo funcional, ejecución de firmware o física avanzada, incluyendo periféricos soportados, reloj, entradas, limitaciones y resultados reproducibles.

## Integración propuesta

Definir interfaz de adaptador con detección de capacidades, validación de artefactos, inicio/pausa/detención, entradas/salidas, eventos y logs. Ejecutar cada motor en proceso aislado, con límites de tiempo/memoria y directorio de trabajo temporal controlado. No conectar un adaptador hasta contar con una prueba de compilación/ejecución repetible de un caso mínimo.
