# Estación ambiental ESP32 (monitor de cacao adaptado)

ESP32 con DHT22 (temperatura y humedad), sensor capacitivo de humedad de
suelo, BH1750 (luz) y HC-SR04 (distancia), enviando a la plataforma por Wi‑Fi
con el **contrato de medidas** (`shm/v1/<ID>/medida`).

Es el sketch «Cacao Smart Monitor» del ingeniero ambiental: mismos pines,
mismo intervalo (10 s) y misma calibración de suelo de partida.

## Qué cambió respecto al sketch original

| Original | Ahora | Por qué |
|---|---|---|
| Tópicos `cacao/estacion001/*` | `shm/v1/LAB-AMB-01/medida` y `…/estado` | El broker solo deja a cada estación publicar en su rama |
| Sensor sin lectura = `-999` | `"value": null` + `"error"` con el motivo | Un -999 acaba en gráficas y promedios como si fuera una medida; la plataforma lo rechaza |
| Sin hora (o `millis()`) | Hora UTC por NTP en cada mensaje; sin hora no envía | Sin instante real no se pueden comparar datos ni estaciones |
| Alertas en el equipo (`…/alertas`) | Ninguna | Los umbrales los firma el ingeniero en el proyecto y los aplica la plataforma |
| ArduinoJson | Mensaje armado en `medidas.h` (probado en el PC) | Una biblioteca menos; el formato se prueba sin placa |
| Si cae la red, se pierde el dato | Cola de 30 mensajes (5 min) en RAM | Los manda al volver la red |
| `ESTACION_ID "CACAO_ESTACION_001"` | `LAB-AMB-01` | Los ID de estación son mayúsculas, cifras y guiones |

El tópico de visión (`…/vision`) del original no está: no hay cámara en este
montaje.

## Conexiones (las del original)

| Sensor | Pin del sensor | ESP32 |
|---|---|---|
| DHT22 | DATA | GPIO 4 (con resistencia de 10 kΩ a 3,3 V si el módulo no la trae) |
| Suelo capacitivo | AOUT | GPIO 34 |
| BH1750 | SDA / SCL | GPIO 21 / GPIO 22 |
| HC-SR04 | TRIG / ECHO | GPIO 5 / GPIO 18 |

**Atención con el HC-SR04:** funciona a 5 V y su ECHO sale a 5 V. El ESP32
admite 3,3 V en sus pines: pon un divisor (por ejemplo 1 kΩ y 2 kΩ) en ECHO o
usa un módulo que trabaje a 3,3 V (HC-SR04P).

## Pasos

1. **Núcleo y bibliotecas** (una vez, desde la carpeta del proyecto):
   ```
   sh scripts/placas.sh nucleo esp32-devkit
   sh scripts/placas.sh biblioteca "DHT sensor library" "BH1750" "PubSubClient"
   ```
   En Windows: `powershell -ExecutionPolicy Bypass -File scripts\placas.ps1 …` con lo mismo.
2. **Plataforma:** la estación `LAB-AMB-01` ya está en
   `proyectos/laboratorio/proyecto.json`. Con `MQTT_RED_IP=<IP del PC>` en
   `plataforma/.env`, ejecuta `iniciar`: crea `MQTT_LAB_AMB_01_PASSWORD` en
   `.env` y abre el puerto **1884** solo en esa IP (ver
   `firmware/esp32-mpu6050/LEEME.md`, pasos 2 y 3, para el cortafuegos).
3. **Secretos:** copia `secretos.ejemplo.h` como `secretos.h` y rellénalo
   (Wi‑Fi, IP del PC, puerto 1884, la clave del paso 2). No se sube al repositorio.
4. **Calibra el suelo:** anota la lectura cruda con el sensor al aire
   (`SUELO_SECO`) y metido en agua hasta la línea (`SUELO_MOJADO`) y ponlas en
   `config.h`. Los valores 3000/1300 son los del sketch original; cada sensor
   da otros.
5. **Carga** el sketch y abre el monitor serie a 115200. Cada 10 s verás
   `MEDIDA {…}`. Al principio verás `# esperando hora NTP` hasta que haya hora.
6. **Comprueba** en Grafana (tablero Operación, proyecto «laboratorio»): una
   gráfica por magnitud y la tabla «Últimas medidas por sensor».

## Si algo falla

| Mensaje / síntoma | Causa probable |
|---|---|
| `# esperando hora NTP` todo el rato | La red no da salida a Internet (NTP). Sin hora no se envía nada |
| `# BH1750 no responde en I2C` | SDA/SCL cruzados o sin alimentar; la luz saldrá `null` con ese motivo |
| Temperatura y humedad `null` («DHT22 sin respuesta») | Cable de datos, falta la resistencia, o un DHT11 en vez de DHT22 |
| Distancia siempre `null` («sin eco») | Nada a su alcance (unos 4 m), ECHO sin divisor o TRIG/ECHO cruzados |
| Suelo siempre 0 % o 100 % | Falta calibrar (paso 4) |
| `MQTT no conecta (código 5)` | Clave equivocada o la estación no está dada de alta |
| `MQTT no conecta (código -2)` | No llega al PC: IP, puerto 1884, cortafuegos o red «pública» |
| Llega a la plataforma pero no se guarda | Mira la tabla `rechazos`: ahí está el motivo exacto |

## Estado

- `medidas.h` probado en el PC: `c++ -std=c++17 -Wall -Wextra -I.. prueba/prueba_medidas.cpp`.
  El mensaje que genera pasa el validador del servidor.
- El camino plataforma (broker → ingesta → base → Grafana → API) está probado
  con mensajes iguales a los del firmware.
- El sketch solo se ha comprobado en sintaxis: **falta compilarlo con el núcleo
  ESP32 y probarlo con los sensores reales.**
