/*
 * ventana.h - Ventana de medición y registro JSON del contrato SHM, sin
 * depender de Arduino (se prueba en el PC: prueba/prueba_ventana.cpp).
 *
 * Contrato: plataforma/contrato + src/shm/data-contract.ts. Lo que hace:
 *   - acumula N muestras de 3 ejes en m/s²; un hueco es NaN, nunca 0;
 *   - CRC-32 IEEE de las muestras como float32 little-endian intercaladas
 *     (la misma definición que «data_crc32» del formato SHMW);
 *   - estadísticas por eje (media, desviación, mín., máx.) sobre lo medido;
 *   - escribe el registro JSON. No etiqueta daño ni seguridad: solo mide.
 */
#ifndef SHM_VENTANA_H
#define SHM_VENTANA_H

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

namespace shm {

inline uint32_t crc32_update(uint32_t crc, const uint8_t *p, size_t n) {
  crc = ~crc;
  while (n--) {
    crc ^= *p++;
    for (int k = 0; k < 8; k++) crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
  }
  return ~crc;
}

struct Ajustes {
  const char *station_id;
  const char *sensor_id;
  const char *firmware_version;
  const char *filter_id;
  float sample_rate_hz;
  float range_g;            /* fondo de escala del sensor, en g */
};

/* Calidad de la hora de la ventana. */
enum Hora { HORA_NTP = 0, HORA_HOLDOVER = 1, HORA_INVALIDA = 2 };

struct Resumen {
  uint32_t secuencia;
  int64_t inicio_utc_ms;
  Hora hora;
  uint32_t muestras, huecos, saturadas, fallos_sensor;
  uint32_t crc;
  int medidas;              /* muestras con valor (no huecos) */
  double media[3], desv[3], minimo[3], maximo[3];
};

/* Analiza una ventana ya completa: datos[i*3 + eje], NaN = hueco. */
inline void resumir(const float *datos, uint32_t n, float limite_saturacion, Resumen &r) {
  double s[3] = {0, 0, 0}, s2[3] = {0, 0, 0};
  r.muestras = n;
  r.huecos = 0;
  r.saturadas = 0;
  r.medidas = 0;
  r.crc = crc32_update(0, reinterpret_cast<const uint8_t *>(datos), (size_t)n * 3 * sizeof(float));
  for (int e = 0; e < 3; e++) { r.minimo[e] = INFINITY; r.maximo[e] = -INFINITY; }
  for (uint32_t i = 0; i < n; i++) {
    const float *m = datos + (size_t)i * 3;
    if (isnan(m[0]) || isnan(m[1]) || isnan(m[2])) { r.huecos++; continue; }
    r.medidas++;
    bool sat = false;
    for (int e = 0; e < 3; e++) {
      double v = m[e];
      s[e] += v; s2[e] += v * v;
      if (v < r.minimo[e]) r.minimo[e] = v;
      if (v > r.maximo[e]) r.maximo[e] = v;
      if (fabs(v) >= limite_saturacion) sat = true;
    }
    if (sat) r.saturadas++;
  }
  for (int e = 0; e < 3; e++) {
    if (r.medidas == 0) { r.media[e] = r.desv[e] = r.minimo[e] = r.maximo[e] = NAN; continue; }
    r.media[e] = s[e] / r.medidas;
    double var = s2[e] / r.medidas - r.media[e] * r.media[e];
    r.desv[e] = var > 0 ? sqrt(var) : 0;
  }
}

inline void hora_rfc3339(int64_t ms, char out[25]) {
  time_t t = (time_t)(ms / 1000);
  struct tm tm;
  gmtime_r(&t, &tm);
  snprintf(out, 25, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday,
           tm.tm_hour, tm.tm_min, tm.tm_sec, (int)(ms % 1000));
}

/* Escribe un número o null (NaN). */
inline int num(char *p, size_t cap, double v) {
  return isnan(v) || isinf(v) ? snprintf(p, cap, "null") : snprintf(p, cap, "%.5g", v);
}

/*
 * Registro JSON de la ventana. Devuelve la longitud, o -1 si no cabe en `cap`.
 * `extra` (puede ser NULL) se añade tal cual dentro del objeto, p. ej. "\"rssi_dbm\":-61".
 */
inline int registro_json(const Ajustes &a, const Resumen &r, char *out, size_t cap, const char *extra) {
  static const char *CALIDAD[] = {"NTP", "HOLDOVER", "INVALID"};
  char ts[25];
  hora_rfc3339(r.inicio_utc_ms, ts);

  const char *estados[4];
  int ne = 0;
  if (r.huecos) estados[ne++] = "DATA_GAP";
  if (r.fallos_sensor) estados[ne++] = "SENSOR_FAULT";
  if (r.saturadas) estados[ne++] = "SATURATED";
  if (r.hora == HORA_HOLDOVER) estados[ne++] = "TIME_HOLDOVER";
  /* HORA_INVALIDA no llega aquí: sin hora no se abre ninguna ventana. */

  size_t n = 0;
#define PON(...) do { int pon_ = snprintf(out + n, n < cap ? cap - n : 0, __VA_ARGS__); if (pon_ < 0) return -1; n += (size_t)pon_; } while (0)
  PON("{\"schema_version\":\"1.0\",\"station_id\":\"%s\",\"sensor_id\":\"%s\",\"timestamp_utc\":\"%s\","
      "\"time_quality\":\"%s\",\"time_uncertainty_us\":null,\"sample_rate_hz\":%g,"
      "\"axes\":[\"x\",\"y\",\"z\"],\"units\":\"m/s2\",\"range_g\":%g,\"filter_id\":\"%s\","
      "\"firmware_version\":\"%s\",\"calibration_id\":null,"
      "\"samples_file\":\"no-guardada/%s/%08lu\",\"samples_crc32\":\"%08lx\",\"states\":[",
      a.station_id, a.sensor_id, ts, CALIDAD[r.hora], (double)a.sample_rate_hz, (double)a.range_g, a.filter_id,
      a.firmware_version, a.station_id, (unsigned long)r.secuencia, (unsigned long)r.crc);
  if (ne == 0) PON("\"NORMAL\"");
  for (int i = 0; i < ne; i++) PON("%s\"%s\"", i ? "," : "", estados[i]);
  PON("],\"health\":{\"sensor_ok\":%s,\"storage_ok\":false,\"pps_locked\":false,\"supply_v\":null},",
      r.fallos_sensor ? "false" : "true");
  PON("\"samples\":%lu,\"gaps\":%lu,\"saturated\":%lu,\"sequence\":%lu,\"stats\":{",
      (unsigned long)r.muestras, (unsigned long)r.huecos, (unsigned long)r.saturadas, (unsigned long)r.secuencia);
  const char *nombres[] = {"mean", "std", "min", "max"};
  const double *vals[] = {r.media, r.desv, r.minimo, r.maximo};
  for (int k = 0; k < 4; k++) {
    PON("%s\"%s\":[", k ? "," : "", nombres[k]);
    for (int e = 0; e < 3; e++) {
      if (e) PON(",");
      int w = num(out + n, n < cap ? cap - n : 0, vals[k][e]);
      if (w < 0) return -1;
      n += (size_t)w;
    }
    PON("]");
  }
  PON("}");
  if (extra && *extra) PON(",%s", extra);
  PON("}");
#undef PON
  return n < cap ? (int)n : -1;
}

}  // namespace shm

#endif
