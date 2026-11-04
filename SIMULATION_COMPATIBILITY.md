# Compatibilidad de simulación — Electronics Lab

## Estado actual

La aplicación no incluye un motor SPICE ni un simulador de microcontroladores. El botón **Simular** está deshabilitado. La vista de LED no expresa un estado calculado y el MPU6050 no entrega telemetría ni responde a I²C. La consola, osciloscopio, analizador lógico, monitor serie y multímetro no reciben datos de simulación.

La validación disponible opera sobre la estructura del circuito: existencia de componentes y pines referenciados, y conexión de terminales requeridos. No calcula voltaje, corriente, potencia, polaridad, continuidad de protoboard ni niveles lógicos.

| MCU / placa | Compilación local | Ejecución de firmware | Periféricos de la escena | Estado |
|---|---|---|---|---|
| ATmega328P / Arduino Uno R3 | Arduino CLI + core AVR disponible; HEX de Blink verificado | No hay motor conectado al laboratorio | Ninguno | Compilar firmware no equivale a simularlo |
| ESP32 DevKit V1 | Core no configurado | No hay motor integrado | MPU6050 y demás componentes son dibujos/modelos de pines | Sin compatibilidad de simulación |

## Evaluación futura

AVR8js puede evaluarse para el núcleo ATmega328P si se integra un adaptador reproducible desde el artefacto compilado y se implementan explícitamente GPIO, temporizadores y periféricos. Esto no simularía automáticamente la placa ni sensores externos. Para SPICE se requiere una integración local aislada y validación con netlists/resultados de referencia. Para ESP32 debe probarse el target y la placa exacta, incluidos los periféricos necesarios; no se inferirá soporte por compatibilidad genérica de QEMU/Renode.

No ejecutar firmware arbitrario con acceso al host. Cualquier futuro motor debe imponer límites de tiempo/memoria y ejecutarse en worker/proceso aislado, con periféricos enumerados por capacidad. Véase [SIMULATION_ENGINE.md](SIMULATION_ENGINE.md).
