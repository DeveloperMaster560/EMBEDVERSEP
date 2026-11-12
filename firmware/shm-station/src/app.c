/*
 * app.c - Lógica de la estación dinámica SD (esqueleto), sin registros del MCU.
 *
 * La usan main.c (STM32H743) y sim_main.c (ordenador, con board_host.c).
 *
 * Hace: arranque, identificación del ADXL355, muestreo a 200 Hz por SPI1,
 * ventanas con CRC-32, hora GNSS (RMC + PPS), estados de calidad, registro
 * JSON por el puerto de servicio y watchdog.
 *
 * NO hace todavía (cada cosa espera una definición de ingenierías):
 *   - filtro antialias/decimación; guardar en la microSD (SDMMC1 + FAT);
 *   - Ethernet al gateway (LwIP + protocolo); SCL3300, ADS1262, LoRa;
 *   - captura fina del PPS con TIM2_CH1; PLL con el cristal HSE.
 */
#include <string.h>

#include "adxl355_regs.h"
#include "board.h"
#include "config.h"
#include "station.h"
#include "app.h"

static station_t g_station;
static time_ref_t g_time;
static char g_json[1024];

static int adxl_read(uint8_t reg, uint8_t *dst, size_t n) {
  uint8_t tx[16] = { ADXL355_CMD_READ(reg) };
  uint8_t rx[16];
  if (n + 1 > sizeof tx) return -1;
  if (accel_spi_transfer(tx, rx, n + 1) != 0) return -1;
  memcpy(dst, rx + 1, n);
  return 0;
}

static int adxl_write(uint8_t reg, uint8_t value) {
  uint8_t tx[2] = { ADXL355_CMD_WRITE(reg), value };
  return accel_spi_transfer(tx, 0, 2);
}

/*
 * ¿Sigue el sensor en el bus? Un MISO sin nadie que lo conduzca lee todo
 * ceros o todo unos, y eso NO puede pasar por una medida (§6: un hueco se
 * marca, nunca se rellena).
 */
static int adxl_present(void) {
  uint8_t id[3];
  if (adxl_read(ADXL355_REG_DEVID_AD, id, 3) != 0) return 0;
  return id[0] == ADXL355_DEVID_AD && id[1] == ADXL355_DEVID_MST && id[2] == ADXL355_PARTID;
}

/* Lee una muestra solo si el sensor dice que hay dato nuevo. */
static int adxl_sample(accel_sample_t *a) {
  uint8_t status, raw[9];
  if (adxl_read(ADXL355_REG_STATUS, &status, 1) != 0) return 0;
  if (!(status & ADXL355_STATUS_DATA_RDY)) return 0;
  if (adxl_read(ADXL355_REG_XDATA3, raw, 9) != 0) return 0;
  a->ok = 1;
  for (unsigned k = 0; k < AXES; k++) a->raw[k] = adxl355_raw20(&raw[k * 3]);
  return 1;
}

/* Comprueba la identidad del sensor y lo pone a medir. */
static int adxl_setup(void) {
  if (!adxl_present()) return 0;
  uint8_t range = ACCEL_RANGE_G == 8 ? 3 : ACCEL_RANGE_G == 4 ? 2 : 1;
  adxl_write(ADXL355_REG_RANGE, range);
  adxl_write(ADXL355_REG_FILTER, ADXL355_ODR_500HZ);
  adxl_write(ADXL355_REG_POWER_CTL, 0); /* fuera de standby */
  return 1;
}

static int32_t lsb_per_g(void) {
  return ACCEL_RANGE_G == 8 ? ADXL355_LSB_PER_G_8G : ACCEL_RANGE_G == 4 ? ADXL355_LSB_PER_G_4G : ADXL355_LSB_PER_G_2G;
}

static void banner(const char *msg) {
  service_write(msg, strlen(msg));
}

static int s_sensor_ok;
static uint32_t s_seen_pps;
static uint32_t s_retry_at;
static uint32_t s_check_at;

void app_init(void) {
  time_init(&g_time);
  station_init(&g_station, STATION_ID, lsb_per_g());
  s_seen_pps = 0;
  s_retry_at = 0;
  s_check_at = 0;
  banner("# SHM " STATION_ID " firmware " FIRMWARE_VERSION " arrancando\n");
  s_sensor_ok = adxl_setup();
  banner(s_sensor_ok ? "# ADXL355 identificado\n" : "# ADXL355 no responde: SENSOR_FAULT\n");
}

int app_step(void) {
  char c;
  while (gnss_read_char(&c)) time_feed_nmea(&g_time, c, board_millis());
  if (g_pps_count != s_seen_pps) {
    s_seen_pps = g_pps_count;
    time_on_pps(&g_time, g_pps_ms);
  }

  if (!g_tick_flag) return 0;
  g_tick_flag = 0;
  uint32_t now = board_millis();

  /* Si el sensor falló, se reintenta cada segundo sin parar el muestreo. */
  if (!s_sensor_ok && (int32_t)(now - s_retry_at) >= 0) {
    s_sensor_ok = adxl_setup();
    s_retry_at = now + 1000u;
  }
  /* Con el sensor bien, se comprueba su identidad una vez por segundo. */
  if (s_sensor_ok && (int32_t)(now - s_check_at) >= 0) {
    s_sensor_ok = adxl_present();
    s_check_at = now + 1000u;
  }

  accel_sample_t a = { 0, { 0, 0, 0 } };
  if (!s_sensor_ok || !adxl_sample(&a)) {
    a.ok = 0;
    if (s_sensor_ok && !adxl_present()) s_sensor_ok = 0;
  }

  if (station_add_sample(&g_station, &a, &g_time, now)) {
    station_health_t h = {
      .sensor_ok = (uint8_t)s_sensor_ok,
      .storage_ok = (uint8_t)storage_ok(),
      .pwr_good_level = (uint8_t)pwr_good_level(),
      .comm_ok = 1,    /* el puerto de servicio no tiene enlace que perder */
    };
    size_t n = station_close_window(&g_station, &h, g_json, sizeof g_json);
    service_write(g_json, n);
  }
  watchdog_kick();
  return 1;
}
