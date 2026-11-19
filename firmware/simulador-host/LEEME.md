# Simulador de placas en el PC

Ejecuta un sketch de Arduino/ESP32 **sin modificarlo** en el PC, con sus
bibliotecas **reales**, y con los sensores leyendo sus valores de un
**escenario** (CSV). Lo que el sketch publica por MQTT se revisa con el
contrato de la plataforma y, si se pide, llega al broker de verdad como si
fuera la estación.

Sirve para que un ingeniero vea su programa funcionando, con sus datos en
Grafana, **antes** de tener la placa, y para encontrar errores sin cablear
nada: formato (tópicos propios, `-999`, sin hora), dirección I2C equivocada,
orden de inicialización, una biblioteca que en esa placa no compila, un
búfer que no alcanza.

## Uso

Desde `plataforma/servicios`:

```
python3 -m shm_plataforma.simular_placa ../../firmware/esp32-ambiente \
    --placa esp32-devkit \
    --escenario ../../firmware/simulador-host/escenarios/cacao-prueba.csv --duracion 600
```

- `--placa`: un id de `server/placas.json` (por omisión `esp32-devkit`).
- `--duracion` son segundos **simulados**: 10 minutos tardan unos segundos.
- `--enviar` publica en el broker (plataforma encendida) con la clave de la
  estación en `plataforma/.env`; la estación tiene que estar en un proyecto.
  Los datos quedan fechados en los últimos `--duracion` segundos.
- `--conectar "MAX31865 cs=10"` conecta un dispositivo SPI o serie (igual
  que `#@ conectar` en el escenario; se puede repetir).
- `--aire archivo` es el «aire» LoRa compartido entre nodos simulados.
- `--pasarela proyecto.json --estacion ID` pasa lo que imprime la placa por la
  pasarela de texto libre, como haría `pasarela_serie` con la placa por USB, y
  valida los mensajes que salen de allí.
- `--json` da el resumen en JSON.
- Sale con 0 si todo cumple el contrato, 3 si algún mensaje no, 1 si no compila.

La primera simulación con una biblioteca grande (RadioLib) tarda unos
segundos en compilarla; después queda en caché (`.tools/simulador/`).

## Cómo funciona: por bus, no por biblioteca

Escribir una imitación de cada biblioteca no escala: son miles y hay varias
para el mismo sensor. Así que:

1. **La biblioteca es la real.** Cada `#include` se resuelve contra la
   biblioteca oficial (`server/bibliotecas.lock.json`), con la misma versión
   fija con la que compila el servidor, desde su `.zip` verificado. Igual que
   `arduino-cli`, se sigue el preprocesador con las macros de la placa: solo
   cuenta lo que se compila para ESA placa.
2. **Lo simulado es el hardware.** `Wire` entrega cada byte al **modelo del
   chip** que responde en esa dirección (`modelos/`): registros, tiempos de
   conversión, CRC y saturación, según la hoja de datos. Un modelo sirve para
   todas las bibliotecas de ese chip.
3. **La placa importa** (`--placa`): macros de su familia
   (`ARDUINO_ARCH_ESP32`…), resolución del ADC (12 bits en ESP32, 10 en AVR),
   búfer I2C (32 bytes en AVR, 128 en ESP32), si tiene Wi-Fi, si existe
   `Serial.printf`, y la API propia de su núcleo (PWM `ledc` del ESP32…).
4. **String, Print, Stream, Client e IPAddress son los del núcleo de
   Arduino** (se toman del núcleo AVR instalado).

Un chip sin modelo, o con su columna vacía en ese instante, **no responde**
(NACK): el programa ve lo mismo que con el sensor desconectado, y el
simulador lo avisa. Nunca se inventan lecturas.

### Modelos de chip (I2C)

| Chip | Dirección | Columnas del escenario |
|---|---|---|
| BH1750 (luz) | 0x23 | `luz` (lux) |
| MPU-6050 (acelerómetro/giróscopo) | 0x68 | `acel_x`, `acel_y`, `acel_z` (m/s², con la gravedad), `giro_x`… (°/s), `temperatura` |
| SCD40/SCD41 (CO₂) | 0x62 | `co2` (ppm), `temperatura`, `humedad` |

El chip está conectado si el escenario tiene su columna principal (la
primera de la lista).

### Dispositivos SPI y de puerto serie

No se identifican solos: en la placa es el cableado el que dice dónde está
cada uno. Aquí lo dice el escenario, con líneas `#@` al principio:

```
#@ conectar MAX31865 cs=10 mosi=11 miso=12 sck=13   (SPI por software: pines sueltos)
#@ conectar SX1276 cs=18 dio0=26 rst=14
#@ conectar GPS rx=4                                 (SoftwareSerial con RX en el pin 4)
#@ conectar PZEM004T serie=Serial2
#@ conectar MODBUS serie=Serial2 dir=1 r0=caudal*10 r1=temperatura*100
t_s,rtd,latitud,longitud,…
```

| Modelo | Bus | Columnas | Detalle |
|---|---|---|---|
| `MAX31865` (PT100/PT1000) | SPI de la placa o por software | `rtd` (°C) | `r0=100`, `rref=430`; vacía = RTD abierto (fallo, fondo de escala) |
| `SX1276`, `SX1278`, `RFM95` (LoRa) | SPI + DIO0 con interrupción | `rssi`, `snr` del receptor | ver «Nodos LoRa» |
| `GPS` (NMEA: NEO-6M/M8N…) | serie | `latitud`, `longitud`, `altitud`, `velocidad_kmh`, `satelites`, `hdop` | RMC + GGA a 1 Hz; vacía = sin posición |
| `PZEM004T` (energía AC) | serie, Modbus | `tension`, `corriente`, `potencia`, `energia` (kWh), `frecuencia`, `factor_potencia` | sin `tension` no responde (se alimenta de la red) |
| `MODBUS` (cualquier esclavo RTU) | serie | las que digan `rN=columna*escala` | funciones 03/04/06; excepciones 02 y 04 |

Los puertos serie tienen el búfer de la placa (64 bytes en AVR y STM32, 256 en
ESP32): si el programa no lee a tiempo, los bytes que no caben se pierden. Si
el programa abre el puerto a otra velocidad que el equipo, llega basura. Las
dos cosas pasan en la placa y aquí también.

### Nodos LoRa

Un nodo transmite y otro recibe, cada uno en su simulación, compartiendo el
archivo `--aire`. Primero se simula el transmisor: sus paquetes quedan en el
aire con su hora, frecuencia, SF, ancho de banda y palabra de sincronía.
Después, el receptor los recibe si en ese instante estaba escuchando con la
misma configuración (si no, se avisa por qué se perdió). Al volver a simular
un nodo se borran sus paquetes anteriores del aire.

```
python3 -m shm_plataforma.simular_placa nodo-agua --placa stm32-bluepill --escenario agua.csv --duracion 300 --aire aire.txt
python3 -m shm_plataforma.simular_placa ../../firmware/lora-receptor --escenario receptor.csv --duracion 300 \
    --aire aire.txt --pasarela proyecto.json --estacion RIO-AGUA-01
```

### Imitados a nivel de biblioteca

Su protocolo depende de tiempos de microsegundos, así que se imitan:

| Biblioteca | Columnas |
|---|---|
| DHT11/DHT22 (`DHT.h`) | `temperatura`, `humedad` |
| DallasTemperature / DS18B20 | `ds18b20`, `ds18b20_1`… (vacía = −127, desconectado) |
| OneWire | sin dispositivos |
| Wi-Fi (`WiFi.h`, API del ESP32) | conecta 1 s después de `begin` |
| PubSubClient (MQTT) | lo publicado va al lanzador; límite real del búfer (256 B) |
| NTP (`configTime`) | sincroniza a los 2 s |

### Pines

| Columna | La lee |
|---|---|
| `A<pin>` | `analogRead(pin)`, en cuentas del ADC de esa placa |
| `D<pin>` | `digitalRead(pin)` (0/1) |
| `distancia_cm` | `pulseIn()` (HC-SR04) |

Un pin que maneja un dispositivo conectado (MISO, DIO0) lo lee de él, no del
escenario, y `attachInterrupt` en ese pin funciona.

En STM32 los pines por nombre son números: `PA6` = 6, `PB0` = 16, `PC13` = 45.

## Escenario

CSV con `t_s` (segundos desde el arranque) y una columna por señal. Entre
filas se interpola; **una celda vacía = el sensor falla** en ese tramo. Las
líneas `#` son comentarios. Los escenarios de `escenarios/` son **inventados
para probar**, no datos medidos.

## Qué NO prueba

Tiempos reales del procesador (consultar la hora, leer un pin o un byte de
SPI cuesta 1 µs fijo), RAM y pila, interrupciones de temporizadores, ruido
eléctrico, alcance de la radio y colisiones entre paquetes LoRa, tensiones (un HC-SR04 a 5 V sin divisor
quema el pin y aquí no pasa nada). En AVR un `int` es de 16 bits y aquí de
32: los desbordes de `int` no se reproducen. No se generan los prototipos de
funciones como hace el IDE. **Que funcione aquí no prueba que funcione en la
placa; que falle aquí casi siempre es un error real.**

## Lo que ya encontró

- RadioLib 8.0.0 cambió `begin()`: `radio.begin(915.0)`, la forma de casi
  todos los ejemplos, deja de compilar. La biblioteca oficial quedó fijada en
  7.8.1 (`server/bibliotecas.json`, `versiones_fijas`).
- En STM32, `analogRead` da 10 bits (0-1023) si no se llama a
  `analogReadResolution(12)`; un sketch que divide entre 4095 calcula pH 18 y
  turbidez negativa. La pasarela los manda como `null` con el motivo.
- PZEM004Tv30 1.2.1: en los primeros 200 ms devuelve ceros sin preguntarle al
  medidor, y tras una lectura fallida `current()`/`energy()` devuelven los
  valores viejos durante 200 ms (solo `voltage()` da NaN). Leer siempre
  `voltage()` primero y descartar todo si es NaN.

## Añadir un modelo de chip

Un archivo en `modelos/`:

- I2C: una clase que hereda de `sim::ChipI2C` (`presente`, `escribir`,
  `leer`) y la línea `SIM_CHIP_I2C(Clase, "NOMBRE", dirección, "columna")`.
- SPI: hereda de `sim::ChipSPI` (`a_enviar`: el byte que sale por MISO;
  `recibido`: el que entró por MOSI); el SPI por software sale solo.
- Serie: hereda de `sim::EquipoSerie` (`del_programa`, `generar` con la hora
  de cada byte); Modbus: de `EsclavoModbus` en `modbus.cpp`.
- Los dos últimos se registran con `SIM_DISPOSITIVO(Clase, "NOMBRE")` y se
  conectan con `#@ conectar NOMBRE …`. `sim::programar(t, f)` ejecuta algo a
  una hora simulada y `sim::pin_cambio(pin, nivel)` dispara interrupciones.
 Se escribe desde la
hoja de datos, no desde una biblioteca (así sirve para todas), y se prueba con
la biblioteca oficial real (ver `pruebas/test_simular_placa.py`).

## Requisitos

Un compilador de C/C++ del PC (en macOS y Linux viene con las herramientas de
desarrollo), el núcleo `arduino:avr` instalado (`sh scripts/placas.sh nucleo
arduino-uno`, de él salen String/Print/Stream) y los `.zip` de la biblioteca
oficial (`python3 scripts/biblioteca_oficial.py` los descarga con su
checksum). **En Windows aún no está probado.**
