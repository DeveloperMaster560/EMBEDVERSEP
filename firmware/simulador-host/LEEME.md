# Simulador de placas en el PC

Ejecuta un sketch de ESP32/Arduino **sin modificarlo** en el PC: el código se
compila con el compilador del PC contra cabeceras que imitan la placa
(`nucleo/`), y los sensores leen sus valores de un **escenario** (CSV). Lo que
el sketch publica por MQTT se revisa con el contrato de la plataforma y, si se
pide, llega al broker de verdad como si fuera la estación.

Sirve para que un ingeniero vea su programa funcionando, con sus datos en
Grafana, **antes** de tener la placa, y para encontrar errores de formato
(tópicos propios, `-999`, sin hora…) sin cablear nada.

## Uso

Desde `plataforma/servicios`:

```
python3 -m shm_plataforma.simular_placa ../../firmware/esp32-ambiente \
    --escenario ../../firmware/simulador-host/escenarios/cacao-prueba.csv --duracion 600
```

- `--duracion` son segundos **simulados**: 10 minutos tardan unos segundos.
- `--enviar` publica en el broker (plataforma encendida) con la clave de la
  estación en `plataforma/.env`; la estación tiene que estar en un proyecto.
  Los datos quedan fechados en los últimos `--duracion` segundos.
- `--json` da el resumen en JSON.
- Sale con 0 si todo cumple el contrato, 3 si algún mensaje no, 1 si no compila.

## Escenario

CSV con `t_s` (segundos desde el arranque) y una columna por señal. Entre filas
se interpola; **una celda vacía = el sensor falla** en ese tramo (así se prueba
qué hace el programa cuando un sensor no responde). Las líneas `#` son
comentarios.

| Columna | La lee | Unidad |
|---|---|---|
| `temperatura`, `humedad` | DHT11 / DHT22 | °C, %HR |
| `luz` | BH1750 (si la columna no existe, `begin()` falla: sensor no conectado) | lux |
| `distancia_cm` | `pulseIn()` (HC-SR04) | cm |
| `A<pin>` | `analogRead(pin)` | cuentas del ADC |
| `D<pin>` | `digitalRead(pin)` | 0 / 1 |

Los escenarios de `escenarios/` son **inventados para probar**, no datos medidos.

## Qué imita

Reloj (`millis`, `delay`, `micros`), `Serial`, `String`, pines, ADC,
`pulseIn`, Wi‑Fi (conecta 1 s después de `begin`), NTP (`configTime` + aviso
de sincronización a los 2 s), `PubSubClient` (con el límite real del búfer:
256 bytes si no se llama a `setBufferSize`), `Wire`, DHT y BH1750.
Bibliotecas de software puro (ArduinoJson) se usan **reales**, instaladas con
`scripts/placas.*`.

Una biblioteca de hardware que no esté imitada hace fallar la compilación con
su nombre: nunca se inventa su comportamiento. Para añadir una, se escribe su
cabecera en `nucleo/` leyendo de una columna del escenario.

## Qué NO prueba

Tiempos reales del procesador, RAM y pila del ESP32, interrupciones, ruido
eléctrico, el radio Wi‑Fi, tensiones (un HC-SR04 a 5 V sin divisor quema el
pin y aquí no pasa nada). **Que funcione aquí no prueba que funcione en la
placa; que falle aquí casi siempre es un error real.**

## Requisitos

Un compilador de C++ del PC. En macOS y Linux viene con las herramientas de
desarrollo (`c++`). En Windows hace falta instalar uno (por ejemplo MinGW-w64);
**en Windows aún no está probado.**
