/*
 * host_test.c - Ejecuta la lógica de la estación en el ordenador.
 *
 * Imprime un registro JSON por escenario; la prueba de la aplicación
 * (src/shm/firmware-host.test.ts) los pasa por el contrato de datos.
 */
#include <stdio.h>
#include <string.h>

#include "adxl355_regs.h"
#include "station.h"

static station_t st;
static char json[1024];

static void nmea(time_ref_t *t, const char *body, uint32_t now) {
  uint8_t sum = 0;
  for (const char *p = body; *p; p++) sum ^= (uint8_t)*p;
  char line[120];
  snprintf(line, sizeof line, "$%s*%02X\r\n", body, sum);
  for (const char *p = line; *p; p++) time_feed_nmea(t, *p, now);
}

static void run(const char *name, int locked, int pps, int sensor_ok, int gap_every, int saturate, int storage, int comm) {
  time_ref_t t;
  time_init(&t);
  station_init(&st, "SD-V2-M", ADXL355_LSB_PER_G_2G);
  uint32_t now = 1000;
  if (locked) {
    time_on_pps(&t, now);
    nmea(&t, "GNRMC,120000.00,A,0707.000,N,07307.000,W,0.0,0.0,121126,,,A", now);
    time_on_pps(&t, now);
  }
  station_health_t h = { (uint8_t)sensor_ok, (uint8_t)storage, 1, (uint8_t)comm };
  for (uint32_t i = 0; i < WINDOW_SAMPLES; i++) {
    now = 1000 + i * (1000 / SAMPLE_RATE_HZ);
    if (pps && i % SAMPLE_RATE_HZ == 0) time_on_pps(&t, now);
    accel_sample_t a = { 1, { 0, 0, ADXL355_LSB_PER_G_2G } };
    if (!sensor_ok || (gap_every && i % gap_every == 0)) a.ok = 0;
    if (saturate && i == 100) a.raw[2] = 524287;
    if (station_add_sample(&st, &a, &t, now)) break;
  }
  size_t n = station_close_window(&st, &h, json, sizeof json);
  printf("%s\t%.*s", name, (int)n, json);
}

int main(void) {
  uint8_t b[3] = { 0xFF, 0xFF, 0xF0 };
  if (adxl355_raw20(b) != -1) return 1;
  if (crc32_ieee((const uint8_t *)"123456789", 9) != 0xCBF43926u) return 2;

  run("normal", 1, 1, 1, 0, 0, 1, 1);
  run("sin_pps", 1, 0, 1, 0, 0, 1, 1);
  run("sin_hora", 0, 0, 1, 0, 0, 1, 1);
  run("sensor", 1, 1, 0, 0, 0, 1, 1);
  run("huecos", 1, 1, 1, 50, 0, 1, 1);
  run("saturado", 1, 1, 1, 0, 1, 1, 1);
  run("sin_sd", 1, 1, 1, 0, 0, 0, 1);
  return 0;
}
