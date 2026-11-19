# Biblioteca oficial de EMBEDVERSE

Los clientes **no instalan bibliotecas**. Pegan su código, el servidor mira
cada `#include` y compila con **nuestras** bibliotecas, siempre en la misma
versión. Así el mismo código da el mismo resultado hoy y dentro de un año, y a
todos los clientes.

## Qué hay

| Archivo | Qué es |
|---|---|
| `bibliotecas.json` | La lista curada: 108 bibliotecas en 17 grupos. **Es lo único que se edita a mano.** |
| `bibliotecas.lock.json` | Generado: versión exacta de cada una + sus 10 dependencias (118), cabeceras, repositorio, checksum. |
| `cabeceras-indice.json` | Generado: para ~13 000 cabeceras del índice de Arduino, qué biblioteca la da. Sirve para decirle al cliente qué pidió. |
| `bibliotecaOficial.ts` | El análisis previo a compilar y `GET /api/bibliotecas`. |

## Qué ve el cliente al compilar

Antes de compilar se revisa **todo de una vez** (placa, núcleo y cada
`#include`) y cada problema dice a quién le toca. El cliente ve primero lo que
él puede cambiar y luego lo que depende del servidor ("ya se avisó al
administrador; no tienes que hacer nada"). La respuesta trae además
`diagnostico: [{codigo, para, mensaje}]`.

| Caso | Código | Para |
|---|---|---|
| Código de otro entorno (PIC/XC8, STM32 HAL, Pico SDK, ESP-IDF, MSP430, 8051, `main()` sin `setup/loop`) | `NO_ES_ARDUINO` (422) | cliente |
| Placa que no está en `placas.json` | `UNSUPPORTED_BOARD` (422) | cliente |
| Biblioteca que no es oficial ni verificada | `BIBLIOTECA_NO_OFICIAL` (422) | cliente |
| Falta el núcleo de la placa en el servidor | `CORE_NOT_INSTALLED` (503) | administrador |
| Biblioteca oficial no instalada | `BIBLIOTECA_OFICIAL_NO_INSTALADA` (503) | administrador |
| Biblioteca instalada en otra versión | `BIBLIOTECA_VERSION_DISTINTA` (503) | administrador |

422 = el cliente tiene algo que cambiar; 503 = solo falta preparar el servidor.
Si falta el núcleo, las bibliotecas se revisan igual con lo que suele traer esa
familia de placas (revisión provisional).

**Modo público** (`EMBEDVERSE_PUBLICO=1`): al cliente no le llegan las
órdenes de instalación; solo quedan en el registro del administrador. En modo
local (el de siempre) aparecen al final bajo «Para el administrador de este
servidor».

El `.ino` puede llamarse como sea (`cacao.ino`): el servidor lo trata como principal.

## Administrador: preparar un servidor

Una vez, desde la carpeta del proyecto:

```
sh scripts/placas.sh oficial
```

Windows: `powershell -ExecutionPolicy Bypass -File scripts\placas.ps1 oficial`

Instala las 118 con su versión exacta en `.tools/arduino-user/libraries`. Si
alguna falla, se vuelve a ejecutar: solo reintenta lo que falta. Los núcleos de
placa se instalan aparte (`placas.sh nucleo <placa>`).

`GET /api/bibliotecas` dice, para cada una, `instalada`, `no_instalada` o
`version_distinta`.

## Registros para el administrador

En `.tools/` (nunca guardan el código del cliente):

| Archivo | Qué anota |
|---|---|
| `solicitudes-bibliotecas.jsonl` | Cabeceras pedidas que no tenemos y qué biblioteca las da |
| `solicitudes-placas.jsonl` | Placas desconocidas y entornos que no son Arduino |
| `avisos-administrador.jsonl` | Núcleos y bibliotecas oficiales que hay que instalar |

`python3 scripts/verificar_biblioteca.py --solicitudes` revisa las más pedidas.

## Cabeceras: públicas e internas

El generador descarga el `.zip` de cada biblioteca (con checksum, sin
instalarla) y lee sus cabeceras reales: el índice solo las declara para 1 de
cada 4 y el nombre no siempre las delata (TinyGPSPlus da `TinyGPS++.h`).
Pública = la usan sus ejemplos, la declara el índice o se llama como la
biblioteca; el resto son **internas** (`config.h` de HX711_ADC) y no sirven
para identificar qué biblioteca pide un cliente. Dos oficiales no pueden dar
la misma cabecera pública: el generador falla si pasa. Por eso de las dos
`HX711.h` quedó solo la de bogde (*HX711 Arduino Library*).

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

## Licencias

`scripts/licencias.py` lee la licencia de cada biblioteca de su propio `.zip`
verificado (archivo LICENSE/COPYING, identificador SPDX o cabeceras) y
`biblioteca_oficial.py` la guarda en el lock (`licencia`, `licencia_grupo`,
`licencia_fuente`). El inventario completo está en
[LICENCIAS_BIBLIOTECAS.md](LICENCIAS_BIBLIOTECAS.md). **No es asesoría legal.**

- Si un archivo del código trae una licencia más restrictiva que la declarada,
  se suman (`Apache-2.0 AND GPL-3.0`): ModbusMaster se declara Apache-2.0
  pero su `util/word.h`, que siempre se incluye, es GPL-3.0.
- Al compilar, la respuesta trae `bibliotecas` (lo que `arduino-cli` enlazó,
  con su licencia: son los avisos de copyright que hay que entregar con el
  firmware) y `avisosLicencia` para GPL, licencia propia o sin licencia. No
  bloquea: el código y la decisión son del cliente.
- El núcleo de Arduino (AVR, SAMD…) es LGPL-2.1: todo firmware de Arduino
  enlaza código LGPL. Al entregar binarios hay que poder dar el código y la
  forma de volver a enlazar (en Arduino: el proyecto y las versiones exactas
  del lock).
- Teensy: la licencia de su núcleo pide que, si un sistema de compilación
  ofrece una placa de PJRC, ofrezca también las parecidas. Por eso están todas.

## Pendiente antes de abrirlo al público

- **Revisión legal** del inventario de licencias (las 7 GPL, las 4 sin
  licencia, NewPing) y de qué se entrega con cada firmware descargado.
- **Compilación remota.** Hoy `/api/compile` solo acepta peticiones del propio
  equipo (`LOCAL_ORIGIN_REQUIRED`). Para clientes por Internet hace falta un
  servicio de compilación con cuentas, límites de uso y aislamiento (cada
  compilación ejecuta herramientas sobre código ajeno).
- **Simulación en el servicio público.** El botón «Simular» ejecuta el
  programa del cliente en el servidor: hoy solo en modo local
  (`SIMULACION_SOLO_LOCAL` con `EMBEDVERSE_PUBLICO=1`). Para el público hace
  falta un entorno aislado (contenedor sin red, límites de CPU y memoria).
  El simulador usa las bibliotecas oficiales reales; lo que falta para un
  sensor es el modelo de su chip (`firmware/simulador-host/modelos`).
