# Biblioteca oficial de EMBEDVERSE

Los clientes **no instalan bibliotecas**. Pegan su código, el servidor mira
cada `#include` y compila con **nuestras** bibliotecas, siempre en la misma
versión. Así el mismo código da el mismo resultado hoy y dentro de un año, y a
todos los clientes.

## Qué hay

| Archivo | Qué es |
|---|---|
| `bibliotecas.json` | La lista curada: 109 bibliotecas en 17 grupos. **Es lo único que se edita a mano.** |
| `bibliotecas.lock.json` | Generado: versión exacta de cada una + sus 10 dependencias (119), cabeceras, repositorio, checksum. |
| `cabeceras-indice.json` | Generado: para ~13 000 cabeceras del índice de Arduino, qué biblioteca la da. Sirve para decirle al cliente qué pidió. |
| `bibliotecaOficial.ts` | El análisis previo a compilar y `GET /api/bibliotecas`. |

## Qué ve el cliente al compilar

| Su código incluye… | Resultado |
|---|---|
| Algo del núcleo de la placa (`Wire.h`, `WiFi.h` en ESP32…) o de C/C++ | Compila |
| Una biblioteca oficial instalada | Compila con la versión fija |
| Una biblioteca que no es oficial (`FastLED.h`…) | **422** `BIBLIOTECA_NO_OFICIAL`, con el nombre de la biblioteca que la da. Queda anotada como solicitud |
| Una oficial que este servidor aún no tiene | **503** `BIBLIOTECA_OFICIAL_NO_INSTALADA` (problema del administrador, no del cliente) |
| Una oficial instalada en otra versión | **503** `BIBLIOTECA_VERSION_DISTINTA` |

El `.ino` puede llamarse como sea (`cacao.ino`): el servidor lo trata como principal.

## Administrador: preparar un servidor

Una vez, desde la carpeta del proyecto:

```
sh scripts/placas.sh oficial
```

Windows: `powershell -ExecutionPolicy Bypass -File scripts\placas.ps1 oficial`

Instala las 119 con su versión exacta en `.tools/arduino-user/libraries`. Si
alguna falla, se vuelve a ejecutar: solo reintenta lo que falta. Los núcleos de
placa se instalan aparte (`placas.sh nucleo <placa>`).

`GET /api/bibliotecas` dice, para cada una, `instalada`, `no_instalada` o
`version_distinta`.

## Qué piden los clientes y no tenemos

`.tools/solicitudes-bibliotecas.jsonl`: una línea por petición rechazada
(fecha, placa, cabecera, bibliotecas que la dan). **No guarda el código del
cliente.** Sirve para decidir qué incorporar.

## Incorporar o actualizar bibliotecas

1. Añadir el nombre exacto en `bibliotecas.json` (grupo que corresponda).
2. `sh scripts/placas.sh lista` (descarga el índice) y luego
   `python3 scripts/biblioteca_oficial.py`.
3. Revisar el diff de `bibliotecas.lock.json`: versiones que cambian,
   dependencias nuevas, cabeceras repetidas (el script avisa).
4. `sh scripts/placas.sh oficial` y compilar los ejemplos.
5. Subir los tres archivos juntos.

Actualizar versiones es lo mismo (paso 2 toma la última del índice): **nunca
en un servidor en uso sin probar antes**, porque cambia lo que compilan los
clientes.

## Pendiente antes de abrirlo al público

- **Licencias.** El índice de Arduino no las trae; en el lock están a `null`.
  Muchas bibliotecas son MIT/BSD, pero varias son **GPL o LGPL**: si
  entregamos el binario compilado a un cliente, hay obligaciones (dar el código
  fuente, permitir re-enlazar). Hay que revisarlas una por una antes de
  publicar.
- **Compilación remota.** Hoy `/api/compile` solo acepta peticiones del propio
  equipo (`LOCAL_ORIGIN_REQUIRED`). Para clientes por Internet hace falta un
  servicio de compilación con cuentas, límites de uso y aislamiento (cada
  compilación ejecuta herramientas sobre código ajeno).
- **Simulación.** Que una biblioteca sea oficial permite **compilar** para la
  placa real. Para **simular** en el PC hace falta además su imitación en
  `firmware/simulador-host/nucleo` (hoy: DHT, BH1750, PubSubClient, WiFi, NTP).
