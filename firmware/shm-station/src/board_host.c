/*
 * board_host.c - Placa SIMULADA para ejecutar app.c en el ordenador.
 *
 * Sustituye a board.c: en lugar de registros del STM32H743 hay un modelo del
 * ADXL355 (mismo protocolo SPI y mismo mapa de registros SIN VERIFICAR que
 * renode/ADXL355_SHM.cs), una cola de caracteres para el GNSS y la salida
 * estándar como puerto de servicio. No emula el chip: ejecuta la lógica del
 * firmware compilada para este ordenador.
 */
#include "board_host.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

volatile uint32_t g_tick_flag;
volatile uint32_t g_pps_ms;
volatile uint32_t g_pps_count;

static uint32_t s_millis;
static char s_rx[4096];
static size_t s_rx_head, s_rx_tail;

/* ---- Modelo del ADXL355 ------------------------------------------------ */

static struct {
  int disconnected;
  uint8_t range, filter, standby;
  double (*feed)[3];
  size_t feed_len, index;
  double fixed[3];
  int use_fixed;
  uint8_t latched[9];
} adxl = { 0, 1, 0, 1, NULL, 0, 0, { 0, 0, 1 }, 0, { 0 } };

int host_load_feed(const char *path) {
  FILE *f = fopen(path, "r");
  if (!f) return -1;
  size_t cap = 8192, n = 0;
  double (*rows)[3] = malloc(cap * sizeof *rows);
  char line[128];
  while (fgets(line, sizeof line, f)) {
    if (line[0] == '#' || line[0] == '\n') continue;
    double x, y, z;
    if (sscanf(line, "%lf,%lf,%lf", &x, &y, &z) != 3) continue;
    if (n == cap) rows = realloc(rows, (cap *= 2) * sizeof *rows);
    rows[n][0] = x; rows[n][1] = y; rows[n][2] = z;
    n++;
  }
  fclose(f);
  free(adxl.feed);
  adxl.feed = rows;
  adxl.feed_len = n;
  adxl.index = 0;
  return (int)n;
}

void host_set_disconnected(int on) { adxl.disconnected = on; }

void host_set_fixed_g(int on, double x, double y, double z) {
  adxl.use_fixed = on;
  adxl.fixed[0] = x; adxl.fixed[1] = y; adxl.fixed[2] = z;
}

static void latch_sample(void) {
  const double *g = adxl.fixed;
  if (!adxl.use_fixed && adxl.feed_len) {
    g = adxl.feed[adxl.index % adxl.feed_len];
    adxl.index++;
  }
  double lsb = adxl.range == 3 ? 64000 : adxl.range == 2 ? 128000 : 256000;
  for (int k = 0; k < 3; k++) {
    long raw = lround(g[k] * lsb);
    if (raw > 524287) raw = 524287;
    if (raw < -524288) raw = -524288;
    uint32_t v = (uint32_t)raw & 0xFFFFFu;
    adxl.latched[k * 3] = (uint8_t)(v >> 12);
    adxl.latched[k * 3 + 1] = (uint8_t)(v >> 4);
    adxl.latched[k * 3 + 2] = (uint8_t)((v & 0xFu) << 4);
  }
}

static uint8_t read_reg(uint8_t r) {
  switch (r) {
    case 0x00: return 0xAD;
    case 0x01: return 0x1D;
    case 0x02: return 0xED;
    case 0x04: return adxl.standby ? 0 : 1;
    case 0x28: return adxl.filter;
    case 0x2C: return adxl.range;
    case 0x2D: return adxl.standby;
    default: break;
  }
  if (r >= 0x08 && r < 0x11) return adxl.latched[r - 0x08];
  return 0;
}

static void write_reg(uint8_t r, uint8_t v) {
  if (r == 0x28) adxl.filter = v;
  if (r == 0x2C) adxl.range = (v & 3u) ? (v & 3u) : 1u;
  if (r == 0x2D) adxl.standby = v & 1u;
}

int accel_spi_transfer(const uint8_t *tx, uint8_t *rx, size_t n) {
  if (n == 0) return 0;
  uint8_t cmd = tx ? tx[0] : 0xFF;
  uint8_t addr = cmd >> 1;
  int reading = cmd & 1u;
  if (rx) rx[0] = 0;
  if (!adxl.disconnected && reading && addr == 0x08) latch_sample();
  for (size_t i = 1; i < n; i++, addr++) {
    uint8_t out = 0;
    if (!adxl.disconnected) {
      if (reading) out = read_reg(addr);
      else write_reg(addr, tx ? tx[i] : 0xFF);
    }
    if (rx) rx[i] = out;
  }
  return 0;
}

/* ---- Resto de la placa ------------------------------------------------- */

void board_init(void) {}
uint32_t board_millis(void) { return s_millis; }

void service_write(const char *s, size_t n) {
  fwrite(s, 1, n, stdout);
  fflush(stdout);
}

int gnss_read_char(char *c) {
  if (s_rx_head == s_rx_tail) return 0;
  *c = s_rx[s_rx_tail];
  s_rx_tail = (s_rx_tail + 1) % sizeof s_rx;
  return 1;
}

int pwr_good_level(void) { return 1; }
/* El firmware no tiene driver de microSD: la placa simulada tampoco lo finge. */
int storage_ok(void) { return 0; }
void watchdog_kick(void) {}

void host_gnss_write(const char *s) {
  for (; *s; s++) {
    size_t next = (s_rx_head + 1) % sizeof s_rx;
    if (next == s_rx_tail) return;
    s_rx[s_rx_head] = *s;
    s_rx_head = next;
  }
}

void host_pps(void) {
  g_pps_ms = s_millis;
  g_pps_count++;
}

void host_tick(void) {
  s_millis += 1000u / SAMPLE_RATE_HZ;
  g_tick_flag++;
}
