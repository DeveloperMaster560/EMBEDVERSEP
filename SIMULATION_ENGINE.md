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

---

## Actualización — 9 de noviembre de 2026

### Dos cosas de este documento han dejado de ser ciertas

**1. AVR8js ya no es «solo el núcleo CPU».** La versión 0.21.1 incluye los
periféricos del microcontrolador: `AVRIOPort` (puertos B, C, D), `AVRTimer`
(0, 1 y 2), `AVRUSART`, `AVRADC`, `AVRTWI`, `AVRSPI`, `AVREEPROM`, `AVRClock`
y `AVRWatchdog`. Lo que sigue siendo cierto es que **no simula los componentes
externos**: un sensor conectado a un pin no responde si nadie escribe su
modelo. Esa distinción es la que importa.

**2. El toolchain de `.tools/` es solo de Windows.** `arduino-cli.exe` es un
binario PE32+ y el compilador descargado es
`avr-gcc-7.3.0-...-i686-w64-mingw32`. **En macOS no se puede compilar nada con
lo que hay en el repositorio.** El `.hex` de Blink se verificó en Windows.

Consecuencia práctica: las pruebas del motor **no dependen del toolchain**.
Usan el ensamblador que trae AVR8js para construir programas mínimos en
memoria, de modo que el motor se puede verificar en cualquier máquina. El
`.hex` compilado solo hace falta para ejecutar firmware real de Arduino.

### Lo que ya existe

`src/simulation/`:

- **`intel-hex.ts`** — lector estricto de Intel HEX. Rechaza checksum
  incorrecto, archivo truncado, longitud que no cuadra, tipo de registro
  desconocido, contenido tras el fin de archivo y escritura fuera de la
  memoria de programa, diciendo siempre en qué línea. Validado contra los
  gestores de arranque reales de la distribución de Arduino (optiboot 328,
  ATmegaBOOT 328 y stk500v2 2560, este último con direccionamiento extendido).
- **`avr-runner.ts`** — adaptador de ejecución para ATmega328P, con avance
  explícito por ciclos (no hay temporizador de fondo), tope de ciclos por
  llamada para que un bucle infinito no cuelgue la aplicación, correspondencia
  de pines de Arduino a puertos físicos, entradas forzables desde fuera,
  tensión analógica inyectable, captura del puerto serie y registro de cambios
  de pin con su ciclo exacto.
- **`CAPABILITIES`** — declara qué se ejecuta y, sobre todo, **qué no**.

### Verificación

28 pruebas. Las que sostienen la afirmación «esto ejecuta firmware de verdad»:

| Afirmación | Cómo se comprueba |
|---|---|
| El periodo del bucle es el del juego de instrucciones | `out`+`out`+`rjmp` = 1+1+2 ciclos; se exige exactamente 4 entre flancos |
| El reloj es el real de la placa | 16.000 ciclos = 1,000000 ms a 16 MHz |
| La ejecución es reproducible | dos instancias con los mismos ciclos dan cambios de pin idénticos |
| El ADC convierte de verdad | 2,5 V sobre referencia de 5 V y 10 bits = 512 cuentas |
| El puerto serie transmite | el firmware escribe en UDR0 y sale `Hi` |
| Las entradas responden al exterior | se fuerza PD2 y el firmware lo copia a PB5 |
| Un `.hex` equivale al binario | el mismo programa, serializado y releído, produce los mismos cambios |

**Defecto encontrado y corregido** al contrastar con archivos reales: el
registro Intel HEX de tipo 03 es **CS:IP** (herencia del 8086), no un entero
plano de 32 bits. La dirección es `(CS << 4) + IP`. Leído plano, el gestor de
arranque del ATmega2560 daba 0x30000000 en vez de 0x3E000. Los archivos
sintéticos de prueba no lo habrían detectado nunca.

## Actualización — 9 de noviembre de 2026, segunda entrega

Las tres carencias que este documento declaraba —integración con la interfaz,
modelos de componentes y el botón deshabilitado— **ya no existen**. El motor
está conectado y se puede usar.

### Lo que se añadió

- **`devices.ts`** — modelos de comportamiento de LED (con medición del ciclo
  de trabajo), LED invertido contra alimentación, pulsador (con la polaridad
  del montaje), módulo de fotocelda LM393 (salida analógica y salida digital
  con umbral) y módulo de relé (bobina y contacto). Cada modelo describe
  comportamiento lógico, no física: un LED sabe si está encendido, no cuántos
  lúmenes da.
- **`binding.ts`** — traza el circuito dibujado hasta los pines del
  microcontrolador. Agrupa los cables en redes, **atraviesa las resistencias en
  serie** y no atraviesa los condensadores (bloquean la continua). Deduce la
  polaridad del montaje: si el cátodo del LED va a masa enciende en alto, y si
  el ánodo va a 5 V enciende en bajo. Lo que no tiene camino hasta un pin **no
  se inventa**: se devuelve en `unresolved` con el motivo.
- **`session.ts`** — junta firmware, circuito y tiempo. Avance explícito en
  milisegundos simulados, con tope por paso para que una pestaña que vuelve de
  segundo plano no pida media hora de golpe.
- **`useSimulation.ts` y `SimulationPanel.tsx`** — el panel del laboratorio.
  Compila con Arduino CLI, carga el `.hex`, ejecuta, y permite accionar las
  entradas: mantener un pulsador, variar la luz que ve una fotocelda y mover el
  umbral de su potenciómetro.
- **Carga directa de `.hex`.** Arduino CLI depende del sistema operativo. Sin
  esto, el motor sería inutilizable en cualquier equipo sin la cadena de
  herramientas instalada.
- **`public/firmware/alumbrado-demo.S` y su `.hex`** — firmware de
  demostración, ensamblable con `tools/make_demo_firmware.mjs`. Conmuta el LED
  de D13 y habla por el puerto serie a 9600 bps.

### Verificación

**59 pruebas** en `src/simulation/`: las 28 anteriores (14 del emulador y 14
del lector de Intel HEX) más 31 nuevas (17 del trazado del circuito, 12 de la
sesión y 2 del firmware publicado). Las que sostienen la afirmación «el
circuito dibujado mueve componentes de verdad»:

| Afirmación | Cómo se comprueba |
|---|---|
| El firmware enciende el LED del circuito | se traza D13 a través de R1, el firmware pone PB5 alto y el LED se lee encendido |
| El ciclo de trabajo medido es exacto | bucle de 4 ciclos con 1 en alto; se exige 0,25 con 4 decimales |
| El usuario acciona y el firmware reacciona | se mantiene el pulsador y el LED sigue al pin en los dos sentidos |
| El convertidor analógico cierra el lazo | la fotocelda baja a 0,5 V, el firmware lee menos de 256 cuentas y enciende |
| El relé respeta su polaridad real | pin en bajo, contacto cerrado: así disparan los módulos |
| El `.hex` publicado funciona | se carga el archivo de `public/firmware`, se ejecuta y se exige ver el LED encendido y apagado |
| El ESP32 no se finge | placa ESP32 y el motor lo declara otra arquitectura |

**Defecto encontrado y corregido** durante esta entrega: el medidor del ciclo
de trabajo clasificaba como «modulado» un pin que cambiaba **una sola vez**
dentro de la ventana de muestreo, y daba el LED por encendido justo después de
apagarlo. Un cambio de estado no es modulación. Ahora se cuentan los flancos y
se exige un mínimo para hablar de PWM. Hay prueba de regresión.

### Lo que sigue sin existir

- **Dispositivos I²C.** El bus se emula y la interfaz de esclavo de avr8js está
  disponible, pero no hay modelo del DS3231 ni del MPU6050. Quedan declarados
  sin simular, con el motivo visible en el panel, en vez de devolver lecturas
  inventadas.
- **ESP32.** Sin compilador y sin motor. No se infiere soporte.
- **Nivel de fidelidad «física».** No hay modelo eléctrico: ni tensiones, ni
  corrientes, ni potencia. Un pin está alto o bajo y nada más. El relé no sabe
  si gobierna un LED o un alumbrado de varios kilovatios.
- **Pines accesibles en el editor.** La placa del laboratorio solo expone siete
  pines (GND, 5V, 3V3, D2, D13, A4/SDA, A5/SCL). El motor sabe trazar D0–D13 y
  A0–A5, pero mientras el editor no los dibuje no se pueden cablear.
- **Verificación en navegador.** Las 59 pruebas se ejecutan sin navegador. La
  comprobación visual del panel **no se ha hecho**: en este equipo la extensión
  de Chrome no consigue abrir el servidor de desarrollo, aunque el servidor
  responde HTTP 200 a `curl`.
- **Compilación en macOS y Linux.** `.tools` solo contiene `arduino-cli.exe`.
  El servidor lo detecta y lo dice con claridad; para compilar fuera de Windows
  hay que instalar Arduino CLI y el core AVR de ese sistema. La carga directa
  de `.hex` existe precisamente por esto.
