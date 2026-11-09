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

---

## Actualización — 9 de noviembre de 2026

Existe un **motor de ejecución de firmware para ATmega328P** en
`src/simulation/`, verificado con 28 pruebas (ciclo exacto, ADC, puerto serie,
entradas y lectura de `.hex` reales de Arduino). Véase
[SIMULATION_ENGINE.md](SIMULATION_ENGINE.md).

**El botón «Simular» sigue deshabilitado, y con razón:** el motor ejecuta el
microcontrolador, pero los componentes de la escena todavía no tienen modelo.
Conectarlo ahora haría parpadear un LED dibujado sin que eso signifique nada.

| MCU / placa | Compilación local | Ejecución de firmware | Periféricos de la escena |
|---|---|---|---|
| ATmega328P / Arduino Uno R3 | Solo en Windows: el `arduino-cli` de `.tools/` es un binario PE32+ | **Sí**, con perifericos del MCU (GPIO, temporizadores, USART, ADC, TWI) | Ninguno modelado todavía |
| ESP32 DevKit V1 | No | No | No |

Sigue vigente: compilar firmware no equivale a simularlo, y ejecutar el
microcontrolador no equivale a simular el circuito.

## Actualización — 9 de noviembre de 2026, segunda entrega

**El botón «Simular» ya funciona.** Los componentes tienen modelo y el circuito
dibujado se traza hasta los pines del microcontrolador. 59 pruebas en
`src/simulation/`.

| MCU / placa | Compilación local | Ejecución de firmware | Periféricos de la escena |
|---|---|---|---|
| ATmega328P / Arduino Uno R3 | Solo en Windows con el `arduino-cli` de `.tools/`; en otros sistemas, cargando un `.hex` ya compilado | **Sí**, con periféricos del MCU (GPIO, temporizadores, USART, ADC, TWI) | LED, LED invertido, pulsador, fotocelda LM393 y módulo de relé |
| ESP32 DevKit V1 | No | No | No |

Lo que **no** cambia:

- No hay modelo eléctrico. Un pin está alto o bajo; no hay tensiones,
  corrientes ni potencia. El estado visual de un relé no dice nada sobre la
  carga que gobierna.
- Los dispositivos I²C (DS3231, MPU6050) **no** tienen modelo. El bus se emula,
  pero el módulo no contestaría. Quedan declarados sin simular en el panel, con
  el motivo, en vez de devolver lecturas inventadas.
- Sigue vigente que compilar firmware no equivale a simularlo, y que ejecutar
  el microcontrolador no equivale a simular el circuito. Ahora se simula
  además la parte lógica de algunos componentes; la parte física, no.
- El requisito de aislamiento sigue cumpliéndose: el firmware se ejecuta en el
  hilo de la página sin ningún acceso al sistema, con tope de ciclos por paso
  para que un bucle infinito no cuelgue la aplicación.
