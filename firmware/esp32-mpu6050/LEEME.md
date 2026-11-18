# ESP32 + MPU6050 → plataforma SHM

Estación de prueba `LAB-ESP32-01` del proyecto `laboratorio`
(`proyectos/laboratorio/proyecto.json`). Mide a 100 Hz, arma ventanas de 10 s
y publica el registro del contrato por Wi‑Fi en el broker de la plataforma.
Mismas bibliotecas y conexión que tus sketches ESP32_A/B: **PubSubClient**,
**Adafruit MPU6050**, **Adafruit Unified Sensor**; SDA 21, SCL 22; ±4 g; 21 Hz.

> Comprobado: la lógica de ventanas y el JSON (`prueba/`, mismo CRC que la
> pasarela del PC) y el recorrido completo de la plataforma con registros
> idénticos. **No compilado con el núcleo ESP32** (no está instalado en el Mac):
> si el IDE marca un error, cópialo tal cual y se corrige.

## Pasos (PC con la plataforma en Windows)

1. `git pull` en `Desarrolo`.
2. **IP del PC en tu red:** `ipconfig` → «Dirección IPv4» del adaptador Wi‑Fi o
   Ethernet (p. ej. `192.168.1.50`). Añade a `plataforma\.env` la línea
   `MQTT_RED_IP=192.168.1.50` (esa IP; **nunca** `0.0.0.0`).
3. Arranca: `powershell -ExecutionPolicy Bypass -File scripts\iniciar.ps1`
   (desde `plataforma`). Dirá «Estaciones por Wi‑Fi: broker en …:1884» y
   creará la contraseña `MQTT_LAB_ESP32_01_PASSWORD` en `.env`.
4. **Cortafuegos de Windows** (PowerShell como administrador, una vez). Solo
   redes privadas, solo el puerto 1884:
   ```
   New-NetFirewallRule -DisplayName "SHM estaciones Wi-Fi" -Direction Inbound -Protocol TCP -LocalPort 1884 -Action Allow -Profile Private
   ```
   Tu Wi‑Fi debe estar como red **privada** en Windows (Configuración → Red →
   propiedades de la red).
5. En esta carpeta, copia `secretos.ejemplo.h` como `secretos.h` y rellena:
   Wi‑Fi, `MQTT_SERVIDOR` = la IP del paso 2, `MQTT_PUERTO` = **1884**,
   `MQTT_CLAVE` = el valor de `MQTT_LAB_ESP32_01_PASSWORD`. (`secretos.h` no
   se sube al repositorio.)
6. Arduino IDE: abre `esp32-mpu6050.ino`, placa «ESP32 Dev Module», sube.
7. Monitor serie a 115200. Lo normal:
   ```
   # LAB-ESP32-01 esp32-mpu6050-0.1.0 arrancando
   # MPU6050 listo
   # Esperando la hora NTP (sin hora no se mide)…
   # MQTT conectado a la plataforma
   # Hora NTP lista: empieza la medición
   SHM {"schema_version":"1.0","station_id":"LAB-ESP32-01",…}      ← cada 10 s
   ```
8. Grafana (http://127.0.0.1:3000) → tablero «SHM — operación por proyecto» →
   proyecto **laboratorio**. Mueve el sensor: «Vibración por ventana» sube;
   «Aceleración media» muestra ~9,8 m/s² en el eje que apunta hacia arriba.

## Si algo falla

| Monitor serie | Qué es |
|---|---|
| `MPU6050 no detectado` | Cables: SDA 21, SCL 22, VCC 3V3, GND |
| se queda en `Esperando la hora NTP` | El ESP32 no tiene Internet (Wi‑Fi mal o red sin salida) |
| `MQTT no conecta (código -2)` | No llega al PC: IP, puerto 1884, cortafuegos o red «pública» |
| `MQTT no conecta (código 4)` o `5` | Clave mal copiada, o no reiniciaste la plataforma tras añadir la estación |
| registros en el monitor pero nada en Grafana | `docker compose logs ingesta` dice por qué se rechazan |

**Plan B, sin Wi‑Fi:** `firmware/muestras-serie` + pasarela serie del PC
(ver `plataforma/CONECTAR_EQUIPOS.md`).

## Qué declara y qué no

- Hora **NTP** (no GNSS): incertidumbre de milisegundos. Sirve para ver la
  plataforma funcionando, no para comparar fase entre estaciones.
- Sin microSD: las muestras crudas no se guardan (`samples_file` = `no-guardada/…`).
- Sin calibración (`calibration_id` null) y ejes del sensor (`x`,`y`,`z`), no
  del puente.
- `stats` son medidas (media, desviación, mín., máx. por eje), no diagnósticos.
