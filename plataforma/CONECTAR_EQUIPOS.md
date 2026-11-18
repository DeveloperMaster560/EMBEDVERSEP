# Conectar equipos a la plataforma

La plataforma no depende del microcontrolador: acepta cualquier equipo que
entregue el **registro del contrato** (`contrato/casos.json`,
`servicios/shm_plataforma/contrato.py`). Hay tres caminos:

| Camino | Para | Qué hace el equipo |
|---|---|---|
| **MQTT directo** | Equipos con red: ESP32, ESP8266, Raspberry Pi Pico W, Raspberry Pi, STM32 con Ethernet, PC | Publica el registro JSON en `shm/v1/<ID>/registro` (usuario = `<ID>`, clave = `MQTT_<ID>_PASSWORD` de `.env`) |
| **Pasarela serie, registros** | Cualquier placa por USB que arme el JSON | Imprime el registro por el puerto serie (con o sin prefijo `SHM `) |
| **Pasarela serie, muestras** | Cualquier placa por USB, la más simple (Arduino Uno, PIC, STM32…) | Imprime `x,y,z` por línea; el PC arma las ventanas |

Ejemplos listos: `firmware/esp32-mpu6050` (MQTT directo) y
`firmware/muestras-serie` (muestras, cualquier placa; compilado para Arduino Uno).

## Dar de alta un equipo

1. Añádelo a un `proyectos/<id>/proyecto.json` con `"estado": "instalada"` (o
   `"simulada"` si no es hardware real). Su `id` es su usuario MQTT.
2. Ejecuta `iniciar`: crea su contraseña en `plataforma/.env` y su usuario en el broker.
3. Cada equipo solo puede publicar en **su** rama (`shm/v1/<su ID>/…`); lo de
   otra rama el broker lo descarta.

## Red

- En el mismo PC: `127.0.0.1:1883`.
- Desde la red local (ESP32 por Wi‑Fi): `MQTT_RED_IP=<IP del PC>` en `.env` →
  puerto **1884** solo en esa IP. Abre el 1884 en el cortafuegos solo para redes
  privadas. La API y Grafana no se exponen por esto.
- Nunca `0.0.0.0`: `preparar.py` lo rechaza.
- Sin TLS todavía: úsalo en tu red de casa o del laboratorio, no por Internet.

## Pasarela serie (PC)

Necesita Python 3.9+ y, para puertos reales, `py -m pip install pyserial`.
Desde `plataforma/servicios`:

```
py -m shm_plataforma.pasarela_serie --estacion LAB-SERIE-01 --puerto COM5 --hz 100 --unidad g --rango-g 4
py -m shm_plataforma.pasarela_serie --estacion LAB-ESP32-01 --puerto COM5         (registros completos)
```

En macOS/Linux el puerto es `/dev/cu.usbserial-…` o `/dev/ttyUSB0`, y `python3`
en lugar de `py`. Lo que la pasarela no puede leer cuenta como **hueco**, nunca
como 0. La hora la pone el PC (se declara `time_uncertainty_us` = 100 000).

## Qué magnitudes se aceptan hoy

El registro actual es el de **aceleración en 3 ejes** (ventanas). Sensores
lentos de un valor (temperatura, humedad, luz, humedad de suelo, distancia…)
necesitan el contrato de telemetría escalar: en preparación.
