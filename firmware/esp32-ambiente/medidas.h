/*
 * Mensaje de MEDIDAS del contrato SHM v1 (tópico shm/v1/<estación>/medida).
 * C++ portable, sin bibliotecas: se prueba en el PC (prueba/prueba_medidas.cpp).
 *
 * Una lectura que falló se envía como "value": null con el motivo en "error".
 * Nunca -999 ni 0: la plataforma rechaza esos centinelas porque acabarían en
 * las gráficas y en los promedios como si se hubieran medido.
 */
#pragma once
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

namespace medidas {

struct Medida {
  const char *sensor_id;
  const char *magnitud;  // nombre del catálogo: temperatura, humedad, luz, humedad_suelo, distancia…
  const char *unidad;    // degC, %HR, lux, %, cm…
  float valor;           // NAN = no hubo lectura
  const char *error;     // motivo si valor es NAN (puede ser nullptr)
  uint8_t decimales;
};

/* 2026-11-19T14:00:00.000Z */
inline void hora_rfc3339(int64_t utc_ms, char out[25]) {
  time_t s = (time_t)(utc_ms / 1000);
  struct tm t;
  gmtime_r(&s, &t);
  snprintf(out, 25, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", t.tm_year + 1900, t.tm_mon + 1, t.tm_mday,
           t.tm_hour, t.tm_min, t.tm_sec, (int)(utc_ms % 1000));
}

/* Escribe el mensaje en out. Devuelve su longitud, o -1 si no cabe. */
inline int mensaje_json(const char *estacion, const char *firmware, int64_t utc_ms, const char *calidad,
                        const Medida *m, int n, char *out, size_t cap) {
  size_t k = 0;
  bool ok = true;
  auto pon = [&](const char *fmt, auto... args) {
    if (!ok) return;
    int r = snprintf(out + k, cap - k, fmt, args...);
    if (r < 0 || (size_t)r >= cap - k) ok = false;
    else k += (size_t)r;
  };
  char hora[25];
  hora_rfc3339(utc_ms, hora);
  pon("{\"schema_version\":\"1.0\",\"station_id\":\"%s\",\"timestamp_utc\":\"%s\",\"time_quality\":\"%s\","
      "\"firmware_version\":\"%s\",\"measurements\":[", estacion, hora, calidad, firmware);
  for (int i = 0; i < n; ++i) {
    pon("%s{\"sensor_id\":\"%s\",\"quantity\":\"%s\",\"unit\":\"%s\",\"value\":", i ? "," : "",
        m[i].sensor_id, m[i].magnitud, m[i].unidad);
    if (isfinite(m[i].valor)) pon("%.*f}", (int)m[i].decimales, (double)m[i].valor);
    else if (m[i].error) pon("null,\"error\":\"%s\"}", m[i].error);
    else pon("%s", "null}");
  }
  pon("%s", "]}");
  return ok ? (int)k : -1;
}

/* Capacitivo de suelo: lectura cruda del ADC → % entre las dos calibraciones.
   Se recorta a 0–100: fuera de ese intervalo el valor no tiene sentido físico
   (y la plataforma lo rechazaría junto con todo el mensaje). */
inline float suelo_porcentaje(int crudo, int seco, int mojado) {
  if (seco == mojado) return NAN;
  float p = 100.0f * (float)(seco - crudo) / (float)(seco - mojado);
  return p < 0 ? 0 : (p > 100 ? 100 : p);
}

/* HC-SR04: microsegundos de eco → cm. 0 = sin eco (pulseIn agotó el tiempo). */
inline float eco_a_cm(unsigned long us) {
  if (us == 0) return NAN;
  return (float)us * 0.0343f / 2.0f;  // 343 m/s: aire a unos 20 °C
}

}  // namespace medidas
