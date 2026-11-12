/*
 * sim_main.c - Ejecuta el firmware (app.c) en el ordenador con la placa
 * simulada. Cada segundo simulado entrega la trama RMC y el PPS, como hará
 * el receptor GNSS, y luego 200 periodos de muestreo.
 *
 *   build/shm-sim <señal.csv> [--seconds N] [--realtime]
 *                 [--fault sensor@20-40] [--fault pps@50-80]
 *                 [--fault tiempo@90-100] [--fault impacto@110]
 *
 * Con --realtime también lee órdenes por la entrada estándar, una por línea:
 *   sensor 1 | sensor 0 | pps 1 | pps 0 | tiempo 1 | tiempo 0 | impacto | salir
 * y escribe «@t N» al terminar cada segundo simulado.
 */
#define _POSIX_C_SOURCE 200809L
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "app.h"
#include "board_host.h"

#define MAX_FAULTS 16
static struct { char name[16]; long from, to; } plan[MAX_FAULTS];
static int nplan;
static int live_sensor, live_pps, live_tiempo, live_impacto;

static int planned(const char *name, long t) {
  for (int i = 0; i < nplan; i++) {
    if (!strcmp(plan[i].name, name) && t >= plan[i].from && t <= plan[i].to) return 1;
  }
  return 0;
}

static void rmc(long epoch, int valid) {
  time_t tt = (time_t)epoch;
  struct tm u;
  gmtime_r(&tt, &u);
  char body[96], line[112];
  snprintf(body, sizeof body, "GNRMC,%02d%02d%02d.00,%c,0707.000,N,07307.000,W,0.0,0.0,%02d%02d%02d,,,A",
           u.tm_hour, u.tm_min, u.tm_sec, valid ? 'A' : 'V', u.tm_mday, u.tm_mon + 1, u.tm_year % 100);
  unsigned sum = 0;
  for (const char *p = body; *p; p++) sum ^= (unsigned char)*p;
  snprintf(line, sizeof line, "$%s*%02X\r\n", body, sum);
  host_gnss_write(line);
}

static void read_commands(void) {
  static char buf[256];
  static size_t len;
  char c;
  while (read(STDIN_FILENO, &c, 1) == 1) {
    if (c != '\n') {
      if (len < sizeof buf - 1) buf[len++] = c;
      continue;
    }
    buf[len] = 0;
    len = 0;
    char name[16] = { 0 };
    int on = 1;
    if (sscanf(buf, "%15s %d", name, &on) < 1) continue;
    if (!strcmp(name, "salir")) exit(0);
    if (!strcmp(name, "sensor")) live_sensor = on;
    if (!strcmp(name, "pps")) live_pps = on;
    if (!strcmp(name, "tiempo")) live_tiempo = on;
    if (!strcmp(name, "impacto")) live_impacto = 1;
  }
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "uso: %s señal.csv [--seconds N] [--realtime] [--fault nombre@desde-hasta]\n", argv[0]);
    return 2;
  }
  long seconds = 60;
  int realtime = 0;
  for (int i = 2; i < argc; i++) {
    if (!strcmp(argv[i], "--seconds") && i + 1 < argc) seconds = atol(argv[++i]);
    else if (!strcmp(argv[i], "--realtime")) realtime = 1;
    else if (!strcmp(argv[i], "--fault") && i + 1 < argc && nplan < MAX_FAULTS) {
      char *spec = argv[++i], *at = strchr(spec, '@');
      if (!at) continue;
      size_t n = (size_t)(at - spec) < sizeof plan[0].name - 1 ? (size_t)(at - spec) : sizeof plan[0].name - 1;
      memcpy(plan[nplan].name, spec, n);
      plan[nplan].from = atol(at + 1);
      char *dash = strchr(at, '-');
      plan[nplan].to = dash ? atol(dash + 1) : plan[nplan].from;
      nplan++;
    }
  }
  if (host_load_feed(argv[1]) <= 0) {
    fprintf(stderr, "No se pudo leer la señal %s\n", argv[1]);
    return 1;
  }
  if (realtime) fcntl(STDIN_FILENO, F_SETFL, fcntl(STDIN_FILENO, F_GETFL) | O_NONBLOCK);

  const long start_epoch = 1794484800; /* 2026-11-12T12:00:00Z, hora simulada */
  board_init();
  app_init();

  for (long t = 0; t < seconds; t++) {
    if (realtime) read_commands();
    int sensor_off = live_sensor || planned("sensor", t);
    int no_time = live_tiempo || planned("tiempo", t);
    int no_pps = no_time || live_pps || planned("pps", t);
    int impact = live_impacto || planned("impacto", t);
    live_impacto = 0;

    host_set_disconnected(sensor_off);
    rmc(start_epoch + t, !no_time);
    if (!no_pps) host_pps();

    for (unsigned k = 0; k < SAMPLE_RATE_HZ; k++) {
      /* El golpe dura 10 muestras (50 ms) a 3 g. */
      host_set_fixed_g(impact && k < 10, 0, 0, 3.0);
      host_tick();
      while (app_step()) {}
    }
    host_set_fixed_g(0, 0, 0, 0);

    if (realtime) {
      printf("@t %ld\n", t + 1);
      fflush(stdout);
      struct timespec ts = { 1, 0 };
      nanosleep(&ts, NULL);
    }
  }
  return 0;
}
