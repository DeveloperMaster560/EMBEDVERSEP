/*
 * shmbin.h - Archivo crudo de ventana «SHMW» v1 (ver FORMATO_BIN.md).
 *
 * PROPUESTA pendiente de validación por ingeniería. Sin acceso al MCU ni a
 * la microSD: construye la cabecera y la ruta; quien escribe es el driver.
 */
#ifndef SHM_SHMBIN_H
#define SHM_SHMBIN_H

#include <stddef.h>
#include <stdint.h>

#include "station.h"

#define SHMBIN_MAGIC "SHMW"
#define SHMBIN_VERSION 1u
#define SHMBIN_HEADER_LEN 160u
#define SHMBIN_SAMPLE_FLOAT32 1u
#define SHMBIN_FLAG_SENSOR_OK 0x1u
#define SHMBIN_FLAG_PPS_LOCKED 0x2u
/* «/SHM/» + id (32) + «/AAAAMMDD/» + «00000000.bin» + 0 */
#define SHMBIN_PATH_LEN 72u

/* Bytes de la sección de datos de la ventana en curso. */
size_t shmbin_data_len(const station_t *s);

/*
 * Cabecera de la ventana en curso (antes de station_close_window, que la
 * reinicia). Devuelve el CRC-32 de los datos, el mismo del registro JSON.
 */
uint32_t shmbin_header(const station_t *s, const char *sensor_id, const station_health_t *h,
                       uint8_t out[SHMBIN_HEADER_LEN]);

/* Ruta en la microSD: /SHM/<estación>/<AAAAMMDD | SINHORA>/<secuencia>.bin */
void shmbin_path(const station_t *s, char out[SHMBIN_PATH_LEN]);

#endif /* SHM_SHMBIN_H */
