# Archivo crudo de ventana «SHMW» v1 — PROPUESTA

> **Estado: propuesta del equipo de software, PENDIENTE de validación por
> ingeniería.** No la fija el diseño técnico; la deriva de sus requisitos.
> Mientras no se valide, cualquier campo puede cambiar (subiendo la versión).

## De dónde sale

`Planos/Diseno_SHM_Viaducto_Novena/diseno_tecnico.md` pide para el
almacenamiento local:

| Requisito del diseño | Cómo lo cubre el formato |
|---|---|
| «control de corrupción, journaling, CRC» (§ almacenamiento) | CRC-32 de la cabecera y CRC-32 de los datos; tamaño exacto comprobable |
| «recuperación ante pérdida de energía y checksum por bloque» (§8) | un archivo por ventana, escrito de una vez y cerrado con `f_sync`; un archivo a medias se detecta (tamaño o CRC) y se descarta sin afectar a los demás |
| «registro circular», «anillo local de al menos 7 días» | un directorio por día UTC: rotar es borrar el directorio más antiguo |
| «no mezclar ventanas con distinta configuración» (§ análisis) | la configuración (muestreo, rango, filtro, firmware) viaja en la cabecera de cada ventana |
| Dimensionado de 3 ejes × 200 Hz × 4 bytes | datos en float32, exactamente eso |

## Organización en la tarjeta: anillo sin sistema de archivos

La tarjeta **no lleva FAT**: FAT32 no tiene journaling y un corte a mitad de
escritura puede dañar su tabla de asignación, y con ella todo lo guardado. En
su lugar (`include/sdring.h`, `src/sdring.c`):

| Bloques (512 B) | Contenido |
|---|---|
| 0 | Superbloque: `SHMRING1`, versión 1, 48 bloques por ranura, primera ranura en 2048, número de ranuras, `station_id`, CRC-32 |
| 2048 + k × 48 … | Ranura k: un archivo SHMW completo, rellenado con 0 hasta 24 576 B |

- La ventana de secuencia `s` va en la ranura `s % ranuras`: la nueva pisa a
  la más antigua (registro circular). 32 GB ≈ 1,3 millones de ranuras ≈ 150
  días a una ventana cada 10 s. Se exige un mínimo de 7 días (diseño); una
  tarjeta menor da `STORAGE_FAULT`.
- Cada ranura se escribe **datos primero y cabecera al final**: si la energía
  se va a mitad, la cabecera vieja no cuadra con sus datos (CRC) y la ranura se
  reutiliza al arrancar. Ninguna otra ranura se toca.
- Al arrancar se busca la última ventana válida (búsqueda binaria, ~17
  lecturas) y la secuencia continúa; nunca retrocede, aunque haya ventanas sin
  guardar.
- Una tarjeta con el superbloque de **otra estación** no se escribe.
- El registro JSON dice dónde quedó la ventana: `"samples_file":
  "sd:SD-V2-M/00012345"`, o `"no-guardada/SD-V2-M/00012345"` con
  `STORAGE_FAULT`.

### Leerla en un PC

Se copia una imagen de la tarjeta (dd, Win32 Disk Imager…; suele pedir
administrador) y se extrae:

```
python -m shm_plataforma.tarjeta imagen.img --salida carpeta/
→ carpeta/SHM/<station_id>/<AAAAMMDD | SINHORA>/<secuencia 8 cifras>.bin
```

Valida cada ranura y lista las dañadas. Nunca escribe en la tarjeta.

**Alternativa para ingeniería:** FAT32 con FatFs (la tarjeta se lee al
enchufarla, a cambio del riesgo de corrupción descrito). El formato SHMW es el
mismo en los dos casos.

## Contenido

Todo en **little-endian** (el del STM32H743 y el de los PC). Un archivo es:

```
[ cabecera: 160 bytes ][ datos: muestras × ejes × 4 bytes ]
```

### Cabecera (160 bytes)

| Offset | Tamaño | Campo | Valor |
|---:|---:|---|---|
| 0 | 4 | `magic` | ASCII `SHMW` |
| 4 | 2 | `version` | `1` |
| 6 | 2 | `header_len` | `160` (un lector salta lo que no conozca de versiones futuras) |
| 8 | 1 | `axes` | `3` |
| 9 | 1 | `sample_type` | `1` = float32 en m/s² (único definido) |
| 10 | 1 | `time_quality` | `0` GNSS_LOCKED, `1` TIME_HOLDOVER, `2` TIME_INVALID — la **peor** de la ventana |
| 11 | 1 | `range_g` | rango del acelerómetro en g |
| 12 | 4 | `sample_rate_mhz` | frecuencia de muestreo en **mili**hercios (200 Hz → 200000) |
| 16 | 8 | `start_utc_ms` | inicio de la ventana, ms UTC desde 1970 (con `TIME_INVALID`: ms desde el arranque) |
| 24 | 4 | `sequence` | número de ventana |
| 28 | 4 | `sample_count` | muestras por eje |
| 32 | 4 | `gaps` | muestras perdidas (van como NaN) |
| 36 | 4 | `saturated` | muestras con algún eje saturado |
| 40 | 4 | `data_crc32` | CRC-32 IEEE de la sección de datos = `samples_crc32` del registro JSON |
| 44 | 4 | `flags` | bit 0: sensor_ok; bit 1: pps_locked. Resto a 0 |
| 48 | 32 | `station_id` | ASCII, relleno con 0 |
| 80 | 32 | `sensor_id` | ASCII, relleno con 0 |
| 112 | 16 | `firmware_version` | ASCII, relleno con 0 |
| 128 | 24 | `filter_id` | ASCII, relleno con 0 |
| 152 | 4 | reservado | 0 |
| 156 | 4 | `header_crc32` | CRC-32 IEEE de los bytes 0–155 |

Los textos van rellenos con 0 y **pueden ocupar todo el campo** sin 0 final.

### Datos

`sample_count × axes` valores float32 IEEE 754, entrelazados por muestra en el
orden longitudinal, transversal, vertical (el de `axes` del registro):

```
x0 y0 z0 x1 y1 z1 …
```

Una muestra que no se pudo leer va como **NaN en los tres ejes, nunca 0**.

## Cómo se valida un archivo

1. Al menos 160 bytes, `magic` = `SHMW`, `version` conocida.
2. `header_crc32` correcto.
3. Tamaño exacto = `header_len + sample_count × axes × 4`. Si sobra o falta,
   el archivo quedó a medias (corte de energía) o se ha manipulado.
4. `data_crc32` correcto.
5. Contra el registro JSON: mismo `station_id`, `sequence`, `samples_crc32` y
   `timestamp_utc`.

Lectores: `plataforma/servicios/shm_plataforma/crudo.py` (Python) y
`src/shm/raw-file.ts` (app). Escritor: `src/shmbin.c` y `src/sdring.c` (firmware). Los tres se
prueban con el mismo archivo, `pruebas/ventana-ejemplo.bin`, que genera
`make host-test`.

## Lo que queda para ingeniería

- Validar o corregir todo lo anterior.
- **float32 frente a enteros del ADXL355**: guardar las cuentas crudas (int32,
  20 bits útiles) conservaría la resolución exacta y permitiría recalibrar; float32
  en m/s² es lo que dimensiona el diseño (4 bytes/muestra). Decisión pendiente.
- Si la ventana debe dividirse en bloques con CRC propio («checksum por
  bloque») o basta el CRC por ventana de 24 KB.
- Anillo en crudo (propuesto) o FAT32.
- Firma o MAC contra manipulación de una tarjeta extraíble (el diseño lo
  menciona; un CRC no protege contra manipulación deliberada).
