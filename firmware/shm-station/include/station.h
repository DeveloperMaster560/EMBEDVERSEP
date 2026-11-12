/*
 * station.h - Lógica de la estación sin acceso a registros del MCU.
 *
 * Todo lo que hay aquí compila igual para el STM32H743 y para el ordenador
 * (make host-test), de modo que se puede probar sin placa ni emulador.
 */
#ifndef SHM_STATION_H
#define SHM_STATION_H

#include <stddef.h>
#include <stdint.h>

#include "config.h"

/* ---- Tiempo: NMEA RMC + PPS (diseño §10) ------------------------------ */

/* El orden importa: de mejor a peor; la ventana se queda con el mayor. */
typedef enum { TQ_GNSS_LOCKED, TQ_HOLDOVER, TQ_INVALID } time_quality_t;

typedef struct {
  char line[96];
  uint8_t len;
  uint8_t rmc_valid;       /* última RMC con estado A y suma correcta */
  int64_t rmc_epoch_s;     /* hora UTC de esa RMC, segundos desde 1970 */
  uint32_t rmc_rx_ms;      /* cuándo llegó, en ms desde el arranque */
  uint32_t last_pps_ms;
  uint8_t pps_seen;
  uint8_t ever_locked;
  uint32_t rmc_count;
  uint32_t nmea_bad;
} time_ref_t;

void time_init(time_ref_t *t);
void time_on_pps(time_ref_t *t, uint32_t now_ms);
void time_feed_nmea(time_ref_t *t, char c, uint32_t now_ms);
time_quality_t time_quality(const time_ref_t *t, uint32_t now_ms);
/* Milisegundos UTC desde 1970; si no hay hora válida, el tiempo desde el arranque. */
int64_t time_utc_ms(const time_ref_t *t, uint32_t now_ms);
const char *time_quality_name(time_quality_t q);
/* RFC 3339 con milisegundos y Z. */
#define TIME_RFC3339_LEN 48
void time_format_rfc3339(int64_t utc_ms, char out[TIME_RFC3339_LEN]);

/* ---- Ventana de aceleración ------------------------------------------- */

typedef struct {
  uint8_t ok;              /* 0 = no se pudo leer: hueco, nunca 0 */
  int32_t raw[AXES];       /* cuentas del sensor */
} accel_sample_t;

typedef struct {
  uint8_t sensor_ok;
  uint8_t storage_ok;
  uint8_t pwr_good_level;  /* nivel leído en PWR_GOOD; la polaridad está PENDIENTE */
  uint8_t comm_ok;
} station_health_t;

typedef struct {
  const char *station_id;
  int32_t lsb_per_g;
  float samples[WINDOW_SAMPLES * AXES]; /* m/s², NaN en los huecos */
  uint32_t count;
  uint32_t gaps;
  uint32_t saturated;
  uint32_t sequence;
  int64_t window_start_utc_ms;
  time_quality_t window_tq;
} station_t;

void station_init(station_t *s, const char *station_id, int32_t lsb_per_g);
/* Devuelve 1 cuando la ventana está completa. */
int station_add_sample(station_t *s, const accel_sample_t *a, const time_ref_t *t, uint32_t now_ms);
/* Cierra la ventana: escribe el registro JSON (una línea) y la reinicia. */
size_t station_close_window(station_t *s, const station_health_t *h, char *out, size_t cap);

/* ---- Utilidades -------------------------------------------------------- */

uint32_t crc32_ieee(const uint8_t *data, size_t len);
/* Convierte los 3 bytes del ADXL355 (20 bits, alineados a la izquierda). */
int32_t adxl355_raw20(const uint8_t b[3]);

#endif /* SHM_STATION_H */
