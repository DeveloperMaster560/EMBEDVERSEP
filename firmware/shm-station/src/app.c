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
 *   - filtro antialias/decimación; el driver SDMMC1 de la microSD (el anillo
 *     sdring.c ya guarda cada ventana si la placa da un dispositivo de bloques);
 *   - Ethernet al gateway (LwIP + protocolo); SCL3300, ADS1262, LoRa;
 *   - captura fina del PPS con TIM2_CH1; PLL con el cristal HSE.
 */
#include <string.h>

#include "adxl355_regs.h"
#include "board.h"
#include "config.h"
#include "sdring.h"
#include "shmbin.h"
#include "station.h"
#include "app.h"

static station_t g_station;
static time_ref_t g_time;
static char g_json[1024];
static void banner(const char *msg) {
  service_write(msg, strlen(msg));
}

static sdring_t g_ring;
static uint8_t g_hdr[SHMBIN_HEADER_LEN];
static int s_sd_last = -99;   /* último resultado anunciado, para no repetirlo */

/* Abre la microSD. La secuencia sigue tras la última ventana guardada. */
static void storage_setup(void) {
  const sdring_dev_t *dev = board_sd();
  g_ring.ok = 0;
  if (!dev) {
    if (s_sd_last != SDRING_E_IO) banner("# sin microSD (STORAGE_FAULT)\n");
    s_sd_last = SDRING_E_IO;
    return;
  }
  int e = sdring_open(&g_ring, dev, STATION_ID, SDRING_MIN_SLOTS);
  /* La secuencia nunca retrocede: una ventana no guardada no se reutiliza. */
  if (e == SDRING_OK && g_ring.next_seq > g_station.sequence) g_station.sequence = g_ring.next_seq;
  if (e == s_sd_last) return;
  s_sd_last = e;
  if (e == SDRING_OK) {
    banner("# microSD lista\n");
  } else {
    banner(e == SDRING_E_OTHER ? "# microSD de otra estacion: no se toca (STORAGE_FAULT)\n"
         : e == SDRING_E_SMALL ? "# microSD demasiado pequena para 7 dias (STORAGE_FAULT)\n"
         : "# microSD no responde (STORAGE_FAULT)\n");
  }
}

/* Guarda la ventana en curso; devuelve 1 si quedó escrita. */
static int storage_save(const station_health_t *h, char *ref, size_t cap) {
  if (!g_ring.ok) return 0;
  shmbin_header(&g_station, "ADXL355-" STATION_ID, h, g_hdr);
  if (sdring_write(&g_ring, g_station.sequence, g_hdr, sizeof g_hdr,
                   (const uint8_t *)g_station.samples, shmbin_data_len(&g_station)) != SDRING_OK) {
    g_ring.ok = 0;   /* se reintenta en la ventana siguiente */
    if (s_sd_last != SDRING_E_IO) banner("# microSD no acepta escrituras (STORAGE_FAULT)\n");
    s_sd_last = SDRING_E_IO;
    return 0;
  }
  sdring_ref(&g_ring, g_station.sequence, ref, cap);
  return 1;
}

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
  s_sd_last = -99;
  storage_setup();
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
      .storage_ok = 1,
      .pwr_good_level = (uint8_t)pwr_good_level(),
      .comm_ok = 1,    /* el puerto de servicio no tiene enlace que perder */
    };
    /* Si la tarjeta falló, se reintenta en cada ventana (abrirla son ~17 lecturas). */
    if (!g_ring.ok) storage_setup();
    char ref[64];
    h.storage_ok = (uint8_t)storage_save(&h, ref, sizeof ref);
    size_t n = station_close_window(&g_station, &h, h.storage_ok ? ref : 0, g_json, sizeof g_json);
    service_write(g_json, n);
  }
  watchdog_kick();
  return 1;
}
