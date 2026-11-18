/*
 * shmbin.c - Cabecera y ruta del archivo crudo «SHMW» v1 (FORMATO_BIN.md).
 *
 * Los enteros se escriben byte a byte en little-endian para no depender del
 * compilador ni del alineamiento. Los datos son el propio búfer float32 de la
 * ventana (el STM32H743 y los PC son little-endian).
 */
#include "shmbin.h"

#include <stdio.h>
#include <string.h>

static void le16(uint8_t *p, uint16_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }
static void le32(uint8_t *p, uint32_t v) { for (int i = 0; i < 4; i++) p[i] = (uint8_t)(v >> (8 * i)); }
static void le64(uint8_t *p, uint64_t v) { for (int i = 0; i < 8; i++) p[i] = (uint8_t)(v >> (8 * i)); }

/* Texto rellenado con 0; si no cabe se corta (puede ocupar todo el campo). */
static void text(uint8_t *p, size_t n, const char *s) {
  size_t len = s ? strlen(s) : 0;
  memset(p, 0, n);
  memcpy(p, s, len < n ? len : n);
}

size_t shmbin_data_len(const station_t *s) {
  return (size_t)s->count * AXES * sizeof(float);
}

uint32_t shmbin_header(const station_t *s, const char *sensor_id, const station_health_t *h,
                       uint8_t out[SHMBIN_HEADER_LEN]) {
  _Static_assert(sizeof(float) == 4, "float32");
  uint32_t data_crc = crc32_ieee((const uint8_t *)s->samples, shmbin_data_len(s));
  memset(out, 0, SHMBIN_HEADER_LEN);
  memcpy(out, SHMBIN_MAGIC, 4);
  le16(out + 4, SHMBIN_VERSION);
  le16(out + 6, SHMBIN_HEADER_LEN);
  out[8] = AXES;
  out[9] = SHMBIN_SAMPLE_FLOAT32;
  out[10] = (uint8_t)s->window_tq;
  out[11] = ACCEL_RANGE_G;
  le32(out + 12, SAMPLE_RATE_HZ * 1000u);
  le64(out + 16, (uint64_t)s->window_start_utc_ms);
  le32(out + 24, s->sequence);
  le32(out + 28, s->count);
  le32(out + 32, s->gaps);
  le32(out + 36, s->saturated);
  le32(out + 40, data_crc);
  le32(out + 44, (h->sensor_ok ? SHMBIN_FLAG_SENSOR_OK : 0u) |
                 (s->window_tq == TQ_GNSS_LOCKED ? SHMBIN_FLAG_PPS_LOCKED : 0u));
  text(out + 48, 32, s->station_id);
  text(out + 80, 32, sensor_id);
  text(out + 112, 16, FIRMWARE_VERSION);
  text(out + 128, 24, FILTER_ID);
  le32(out + 156, crc32_ieee(out, 156));
  return data_crc;
}

void shmbin_path(const station_t *s, char out[SHMBIN_PATH_LEN]) {
  char day[9] = "SINHORA";
  if (s->window_tq != TQ_INVALID) {
    char ts[TIME_RFC3339_LEN];
    time_format_rfc3339(s->window_start_utc_ms, ts);
    snprintf(day, sizeof day, "%.4s%.2s%.2s", ts, ts + 5, ts + 8);
  }
  snprintf(out, SHMBIN_PATH_LEN, "/SHM/%.32s/%s/%08lu.bin", s->station_id, day, (unsigned long)s->sequence);
}
