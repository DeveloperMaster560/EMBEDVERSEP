# Conectar equipos a la plataforma

La plataforma no depende del microcontrolador: acepta cualquier equipo que
entregue los mensajes del contrato (ver «Dos tipos de mensaje»). Hay tres caminos:

| Camino | Para | Qué hace el equipo |
|---|---|---|
| **MQTT directo** | Equipos con red: ESP32, ESP8266, Raspberry Pi Pico W, Raspberry Pi, STM32 con Ethernet, PC | Publica el JSON en `shm/v1/<ID>/registro` o `shm/v1/<ID>/medida` (usuario = `<ID>`, clave = `MQTT_<ID>_PASSWORD` de `.env`) |
| **Pasarela serie, mensajes** | Cualquier placa por USB que arme el JSON | Imprime el registro (prefijo `SHM `) o la medida (prefijo `MEDIDA `) por el puerto serie |
| **Pasarela serie, muestras** | Cualquier placa por USB, la más simple (Arduino Uno, PIC, STM32…) | Imprime `x,y,z` por línea; el PC arma las ventanas |

Ejemplos listos: `firmware/esp32-mpu6050` (vibración, MQTT directo),
`firmware/esp32-ambiente` (sensores lentos, MQTT directo) y
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

## Dos tipos de mensaje

| Tópico | Para | Contrato |
|---|---|---|
| `shm/v1/<ID>/registro` | Vibración e inclinación: ventanas de muestras rápidas en varios ejes | `contrato.py`, casos en `contrato/casos.json` |
| `shm/v1/<ID>/medida` | Sensores lentos de un valor: temperatura, humedad, luz, suelo, distancia, gases… | `contrato_medidas.py`, casos en `contrato/casos-medidas.json` |

Un mensaje de **medida** lleva todos los sensores de la estación en el mismo instante:

```json
{"schema_version": "1.0", "station_id": "LAB-AMB-01",
 "timestamp_utc": "2026-11-19T14:00:00.000Z", "time_quality": "NTP",
 "firmware_version": "esp32-ambiente-0.1.0",
 "measurements": [
  {"sensor_id": "DHT22-T-LAB-AMB-01", "quantity": "temperatura", "unit": "degC", "value": 24.3},
  {"sensor_id": "BH1750-LAB-AMB-01", "quantity": "luz", "unit": "lux", "value": null, "error": "BH1750 sin respuesta"}]}
```

Reglas que la plataforma hace cumplir (si una falla, se rechaza el mensaje
entero y queda en `rechazos` con el motivo):

- Sensor que no leyó → `"value": null` (y si se quiere, `"error"`). **Nunca
  -999, -9999, 9999 ni 0**: acabarían en gráficas y promedios como si se
  hubieran medido.
- Hora UTC real (`timestamp_utc` RFC 3339): sin hora válida, el equipo no envía.
  `millis()` no sirve.
- Magnitud y unidad del catálogo de abajo; valores físicamente imposibles
  (humedad de 150 %, luz negativa) se rechazan.
- Sin alertas ni diagnósticos en el equipo: los umbrales los firma el
  ingeniero en `criterios` del proyecto.
- Reenviar el mismo mensaje no duplica (clave: sensor + instante).

Ejemplo completo: `firmware/esp32-ambiente` (el sketch del monitor de cacao
adaptado). Por USB sin Wi‑Fi, la pasarela serie reenvía las líneas `MEDIDA {…}`.
Grafana (tablero Operación) muestra una gráfica por magnitud y la última
lectura de cada sensor; la API, `GET /api/v1/estaciones/<ID>/medidas`.

## Magnitudes aceptadas

Fuente única: `servicios/shm_plataforma/magnitudes.json` (la leen el
`proyecto.json`, el contrato de medidas del servidor y el de la app). Para
añadir una magnitud se edita solo ese archivo. Los límites son **físicos**, no
umbrales de alerta.

| Magnitud | Unidades | Límites físicos | Sensores típicos |
|---|---|---|---|
| `aceleracion` | `m/s2`, `g` | varios ejes → **registro** | ADXL355, MPU6050, ADXL345 |
| `inclinacion` | `deg`, `mrad` | varios ejes → **registro** | SCL3300 |
| `deformacion` | `microdeformacion` | — | galgas con HX711 o ADS1262 |
| `desplazamiento` | `mm`, `cm` | — | LVDT, láser |
| `temperatura` | `degC` | -273.15 …  | DHT22, DS18B20, PT100, BME280 |
| `humedad` | `%HR` | 0 … 100 | DHT22, SHT31, BME280 |
| `presion` | `hPa`, `kPa` | 0 …  | BMP280, BME280 |
| `luz` | `lux` | 0 …  | BH1750, TSL2591, VEML7700 |
| `indice_uv` | `UVI` | 0 …  | VEML6070 |
| `humedad_suelo` | `%` | 0 … 100 | capacitivo v1.2, STEMMA |
| `distancia` | `mm`, `cm`, `m` | 0 …  | HC-SR04, VL53L1X, TFmini |
| `ph` | `pH` | 0 … 14 | DFRobot pH |
| `conductividad` | `uS/cm` | 0 …  | sonda EC |
| `solidos_disueltos` | `ppm` | 0 …  | TDS CQRobot |
| `co2` | `ppm` | 0 …  | SCD30, SCD41 |
| `compuestos_volatiles` | `ppb` | 0 …  | SGP30, ENS160 |
| `material_particulado` | `ug/m3` | 0 …  | PMS5003, SDS011 |
| `velocidad_viento` | `m/s`, `km/h` | 0 …  | anemómetro |
| `direccion_viento` | `deg` | 0 … 360 | veleta |
| `lluvia` | `mm` | 0 …  | pluviómetro de balancín |
| `corriente` | `A`, `mA` | — | INA219, SCT-013 |
| `tension` | `V` | — | INA219, divisor |
| `potencia` | `W` | — | INA226, PZEM-004T |
| `fuerza` | `N`, `kgf` | — | celda de carga + HX711 |
| `masa` | `kg`, `g` | — | balanza con HX711 |
