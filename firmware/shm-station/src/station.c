/*
 * station.c - Ventanas, CRC-32, tiempo GNSS y registro JSON.
 *
 * Reglas del diseño que se aplican aquí:
 *  - un hueco se marca (NaN y DATA_GAP), nunca se rellena con cero (§6);
 *  - la calidad de tiempo viaja con cada registro (§10);
 *  - el firmware no emite diagnósticos estructurales: solo estados de
 *    calidad de la lista cerrada (§7). Eso lo decide la plataforma.
 */
#include "station.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#define G_MS2 9.80665f
/* Fondo de escala de 20 bits con margen: por encima se considera saturado. */
#define RAW_SATURATION 524000

/* ======================================================================= */
/* CRC-32 IEEE 802.3 (el mismo que comprueba la plataforma)                */
/* ======================================================================= */

uint32_t crc32_ieee(const uint8_t *data, size_t len) {
  uint32_t c = 0xFFFFFFFFu;
  for (size_t i = 0; i < len; i++) {
    c ^= data[i];
    for (int k = 0; k < 8; k++) c = (c & 1u) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
  }
  return c ^ 0xFFFFFFFFu;
}

int32_t adxl355_raw20(const uint8_t b[3]) {
  uint32_t v = ((uint32_t)b[0] << 12) | ((uint32_t)b[1] << 4) | ((uint32_t)b[2] >> 4);
  if (v & 0x80000u) v |= 0xFFF00000u; /* extensión de signo de 20 bits */
  return (int32_t)v;
}

/* ======================================================================= */
/* Calendario (algoritmos de días civiles de H. Hinnant)                   */
/* ======================================================================= */

static int64_t days_from_civil(int64_t y, unsigned m, unsigned d) {
  y -= m <= 2;
  const int64_t era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (int64_t)doe - 719468;
}

static void civil_from_days(int64_t z, int *y, unsigned *m, unsigned *d) {
  z += 719468;
  const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = (unsigned)(z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  *d = doy - (153 * mp + 2) / 5 + 1;
  *m = mp < 10 ? mp + 3 : mp - 9;
  *y = (int)((int64_t)yoe + era * 400 + (*m <= 2));
}

void time_format_rfc3339(int64_t utc_ms, char out[32]) {
  int64_t s = utc_ms >= 0 ? utc_ms / 1000 : 0;
  unsigned ms = (unsigned)(utc_ms >= 0 ? utc_ms % 1000 : 0);
  int64_t days = s / 86400;
  unsigned rem = (unsigned)(s % 86400);
  int y;
  unsigned mo, d;
  civil_from_days(days, &y, &mo, &d);
  snprintf(out, 32, "%04d-%02u-%02uT%02u:%02u:%02u.%03uZ", y, mo, d, rem / 3600, (rem / 60) % 60, rem % 60, ms);
}

/* ======================================================================= */
/* Tiempo: NMEA RMC + PPS                                                  */
/* ======================================================================= */

void time_init(time_ref_t *t) { memset(t, 0, sizeof *t); }

void time_on_pps(time_ref_t *t, uint32_t now_ms) {
  t->last_pps_ms = now_ms;
  t->pps_seen = 1;
  if (t->rmc_valid) t->ever_locked = 1;
}

static int hexval(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

static int two(const char *p) {
  if (p[0] < '0' || p[0] > '9' || p[1] < '0' || p[1] > '9') return -1;
  return (p[0] - '0') * 10 + (p[1] - '0');
}

/* Valida la suma y, si es RMC con estado A, toma la hora. */
static void parse_line(time_ref_t *t, uint32_t now_ms) {
  const char *l = t->line;
  char *star = strchr(l, '*');
  if (l[0] != '$' || !star || star[1] == 0 || star[2] == 0) return;
  uint8_t sum = 0;
  for (const char *p = l + 1; p < star; p++) sum ^= (uint8_t)*p;
  int hi = hexval(star[1]), lo = hexval(star[2]);
  if (hi < 0 || lo < 0 || sum != (uint8_t)(hi * 16 + lo)) {
    t->nmea_bad++;
    return;
  }
  if (strlen(l) < 7 || strncmp(l + 3, "RMC,", 4) != 0) return;

  /* Campos: 1 hora, 2 estado, 9 fecha */
  const char *f[13] = {0};
  int n = 0;
  for (const char *p = l; p < star && n < 13; p++) {
    if (*p == ',') f[n++] = p + 1;
  }
  if (n < 9) return;
  const char *hms = f[0], *status = f[1], *date = f[8];
  if (*status != 'A') {
    t->rmc_valid = 0;
    return;
  }
  int hh = two(hms), mm = two(hms + 2), ss = two(hms + 4);
  int dd = two(date), mo = two(date + 2), yy = two(date + 4);
  if (hh < 0 || mm < 0 || ss < 0 || dd < 1 || mo < 1 || mo > 12 || yy < 0) return;
  t->rmc_epoch_s = days_from_civil(2000 + yy, (unsigned)mo, (unsigned)dd) * 86400 + hh * 3600 + mm * 60 + ss;
  t->rmc_rx_ms = now_ms;
  t->rmc_valid = 1;
  t->rmc_count++;
}

void time_feed_nmea(time_ref_t *t, char c, uint32_t now_ms) {
  if (c == '$') t->len = 0;
  if (c == '\r' || c == '\n') {
    if (t->len) {
      t->line[t->len] = 0;
      parse_line(t, now_ms);
    }
    t->len = 0;
    return;
  }
  if (t->len < sizeof t->line - 1) t->line[t->len++] = c;
  else t->len = 0; /* línea demasiado larga: se descarta */
}

time_quality_t time_quality(const time_ref_t *t, uint32_t now_ms) {
  int pps_ok = t->pps_seen && (uint32_t)(now_ms - t->last_pps_ms) <= PPS_TIMEOUT_MS;
  if (t->rmc_valid && pps_ok) return TQ_GNSS_LOCKED;
  if (t->ever_locked && t->rmc_epoch_s > 0) return TQ_HOLDOVER;
  return TQ_INVALID;
}

int64_t time_utc_ms(const time_ref_t *t, uint32_t now_ms) {
  if (t->rmc_epoch_s > 0) return t->rmc_epoch_s * 1000 + (int64_t)(uint32_t)(now_ms - t->rmc_rx_ms);
  return (int64_t)now_ms;
}

const char *time_quality_name(time_quality_t q) {
  switch (q) {
    case TQ_GNSS_LOCKED: return "GNSS_LOCKED";
    case TQ_HOLDOVER: return "HOLDOVER";
    default: return "INVALID";
  }
}

/* ======================================================================= */
/* Ventana                                                                 */
/* ======================================================================= */

void station_init(station_t *s, const char *station_id, int32_t lsb_per_g) {
  memset(s, 0, sizeof *s);
  s->station_id = station_id;
  s->lsb_per_g = lsb_per_g;
}

int station_add_sample(station_t *s, const accel_sample_t *a, const time_ref_t *t, uint32_t now_ms) {
  /* La ventana declara la PEOR calidad de tiempo que tuvo, no la del inicio. */
  time_quality_t q = time_quality(t, now_ms);
  if (s->count == 0) {
    s->window_tq = q;
    s->window_start_utc_ms = time_utc_ms(t, now_ms);
  } else if (q > s->window_tq) {
    s->window_tq = q;
  }
  float *dst = &s->samples[s->count * AXES];
  if (!a->ok) {
    for (unsigned k = 0; k < AXES; k++) dst[k] = NAN;
    s->gaps++;
  } else {
    int sat = 0;
    for (unsigned k = 0; k < AXES; k++) {
      dst[k] = (float)a->raw[k] / (float)s->lsb_per_g * G_MS2;
      if (a->raw[k] >= RAW_SATURATION || a->raw[k] <= -RAW_SATURATION) sat = 1;
    }
    s->saturated += (uint32_t)sat;
  }
  s->count++;
  return s->count >= WINDOW_SAMPLES;
}

static size_t append(char *out, size_t cap, size_t pos, const char *fmt_str) {
  size_t n = strlen(fmt_str);
  if (pos + n < cap) memcpy(out + pos, fmt_str, n + 1);
  return pos + n;
}

size_t station_close_window(station_t *s, const station_health_t *h, char *out, size_t cap) {
  uint32_t crc = crc32_ieee((const uint8_t *)s->samples, (size_t)s->count * AXES * sizeof(float));
  char ts[32];
  time_format_rfc3339(s->window_start_utc_ms, ts);

  /* Estados de calidad (lista cerrada, data-contract §7). */
  const char *states[8];
  int ns = 0;
  if (!h->sensor_ok) states[ns++] = "SENSOR_FAULT";
  if (s->gaps) states[ns++] = "DATA_GAP";
  if (s->saturated) states[ns++] = "SATURATED";
  if (s->window_tq == TQ_HOLDOVER) states[ns++] = "TIME_HOLDOVER";
  if (s->window_tq == TQ_INVALID) states[ns++] = "TIME_INVALID";
  if (!h->storage_ok) states[ns++] = "STORAGE_FAULT";
  if (!h->comm_ok) states[ns++] = "COMM_LOST";
  if (ns == 0) states[ns++] = "NORMAL";

  char buf[160];
  size_t p = 0;
  out[0] = 0;
  snprintf(buf, sizeof buf, "{\"schema_version\":\"%s\",\"station_id\":\"%s\",\"sensor_id\":\"ADXL355-%s\",",
           RECORD_SCHEMA_VERSION, s->station_id, s->station_id);
  p = append(out, cap, p, buf);
  snprintf(buf, sizeof buf, "\"timestamp_utc\":\"%s\",\"time_quality\":\"%s\",\"time_uncertainty_us\":null,",
           ts, time_quality_name(s->window_tq));
  p = append(out, cap, p, buf);
  snprintf(buf, sizeof buf, "\"sample_rate_hz\":%u,\"axes\":[\"longitudinal\",\"transversal\",\"vertical\"],\"units\":\"m/s2\",\"range_g\":%u,",
           (unsigned)SAMPLE_RATE_HZ, (unsigned)ACCEL_RANGE_G);
  p = append(out, cap, p, buf);
  snprintf(buf, sizeof buf, "\"filter_id\":\"%s\",\"firmware_version\":\"%s\",\"calibration_id\":null,",
           FILTER_ID, FIRMWARE_VERSION);
  p = append(out, cap, p, buf);
  snprintf(buf, sizeof buf, "\"samples_file\":\"pendiente-sd/%s/%06lu.bin\",\"samples_crc32\":\"%08lx\",\"states\":[",
           s->station_id, (unsigned long)s->sequence, (unsigned long)crc);
  p = append(out, cap, p, buf);
  for (int i = 0; i < ns; i++) {
    snprintf(buf, sizeof buf, "%s\"%s\"", i ? "," : "", states[i]);
    p = append(out, cap, p, buf);
  }
  snprintf(buf, sizeof buf, "],\"health\":{\"sensor_ok\":%s,\"storage_ok\":%s,\"pps_locked\":%s,\"supply_v\":null},",
           h->sensor_ok ? "true" : "false", h->storage_ok ? "true" : "false",
           s->window_tq == TQ_GNSS_LOCKED ? "true" : "false");
  p = append(out, cap, p, buf);
  snprintf(buf, sizeof buf, "\"samples\":%lu,\"gaps\":%lu,\"saturated\":%lu,\"pwr_good_level\":%u}\n",
           (unsigned long)s->count, (unsigned long)s->gaps, (unsigned long)s->saturated, (unsigned)h->pwr_good_level);
  p = append(out, cap, p, buf);

  s->sequence++;
  s->count = 0;
  s->gaps = 0;
  s->saturated = 0;
  return p < cap ? p : 0;
}
