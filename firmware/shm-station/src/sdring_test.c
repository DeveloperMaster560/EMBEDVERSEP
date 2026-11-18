/*
 * sdring_test.c - Anillo de la microSD contra una tarjeta en memoria.
 *
 * make ring-test. Con un argumento escribe además la imagen de la tarjeta
 * (para la herramienta de extracción y sus pruebas).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "adxl355_regs.h"
#include "sdring.h"
#include "shmbin.h"
#include "station.h"

#define SLOTS 20u
#define BLOCKS (SDRING_FIRST_SLOT_LBA + SLOTS * SDRING_SLOT_BLOCKS)

static uint8_t card[BLOCKS][SDRING_BLOCK];
static int writes_left = -1;   /* <0: sin límite; 0: se va la energía */

static int rd(void *ctx, uint32_t lba, uint8_t *buf, uint32_t n) {
  (void)ctx;
  if (lba + n > BLOCKS) return -1;
  memcpy(buf, card[lba], (size_t)n * SDRING_BLOCK);
  return 0;
}
static int wr(void *ctx, uint32_t lba, const uint8_t *buf, uint32_t n) {
  (void)ctx;
  if (lba + n > BLOCKS) return -1;
  if (writes_left == 0) return -1;
  if (writes_left > 0) writes_left--;
  memcpy(card[lba], buf, (size_t)n * SDRING_BLOCK);
  return 0;
}

static const sdring_dev_t DEV = { rd, wr, BLOCKS, 0 };
static station_t st;
static int fails;

#define CHECK(cond, msg) do { if (!(cond)) { printf("FALLA: %s (línea %d)\n", msg, __LINE__); fails++; } } while (0)

/* Llena una ventana completa con la secuencia `seq` y la escribe en el anillo. */
static int write_window(sdring_t *r, uint32_t seq) {
  time_ref_t t;
  time_init(&t);
  station_init(&st, "SD-V2-M", ADXL355_LSB_PER_G_2G);
  st.sequence = seq;
  for (uint32_t i = 0; i < WINDOW_SAMPLES; i++) {
    accel_sample_t a = { 1, { (int32_t)(seq * 7 + i), -(int32_t)i, ADXL355_LSB_PER_G_2G } };
    station_add_sample(&st, &a, &t, 1000 + i * 5);
  }
  station_health_t h = { 1, 1, 1, 1 };
  uint8_t hdr[SHMBIN_HEADER_LEN];
  shmbin_header(&st, "ADXL355-SD-V2-M", &h, hdr);
  return sdring_write(r, seq, hdr, sizeof hdr, (const uint8_t *)st.samples, shmbin_data_len(&st));
}

/* Comprueba la ranura de `seq` igual que lo haría un lector: tamaño y los dos CRC. */
static int slot_intact(uint32_t seq) {
  const uint8_t *s = card[SDRING_FIRST_SLOT_LBA + (seq % SLOTS) * SDRING_SLOT_BLOCKS];
  uint32_t n = (uint32_t)s[28] | (uint32_t)s[29] << 8 | (uint32_t)s[30] << 16 | (uint32_t)s[31] << 24;
  uint32_t dcrc = (uint32_t)s[40] | (uint32_t)s[41] << 8 | (uint32_t)s[42] << 16 | (uint32_t)s[43] << 24;
  uint32_t sq = (uint32_t)s[24] | (uint32_t)s[25] << 8 | (uint32_t)s[26] << 16 | (uint32_t)s[27] << 24;
  return sq == seq && crc32_ieee(s + SHMBIN_HEADER_LEN, (size_t)n * AXES * 4) == dcrc;
}

int main(int argc, char **argv) {
  sdring_t r;

  CHECK(sdring_open(&r, &DEV, "SD-V2-M", SLOTS + 1) == SDRING_E_SMALL, "tarjeta pequeña se rechaza");
  CHECK(sdring_open(&r, &DEV, "SD-V2-M", SLOTS) == SDRING_OK, "tarjeta vacía se prepara");
  CHECK(r.slots == SLOTS && r.next_seq == 0, "vacía empieza en 0");

  for (uint32_t s = 0; s < 7; s++) CHECK(write_window(&r, s) == SDRING_OK, "escribir");
  CHECK(sdring_open(&r, &DEV, "SD-V2-M", SLOTS) == SDRING_OK && r.next_seq == 7, "tras reiniciar sigue en 7");
  CHECK(slot_intact(6), "ranura 6 íntegra");

  for (uint32_t s = 7; s < 47; s++) write_window(&r, s);
  CHECK(sdring_open(&r, &DEV, "SD-V2-M", SLOTS) == SDRING_OK && r.next_seq == 47, "con vueltas sigue en 47");
  CHECK(slot_intact(46) && slot_intact(27), "la última vuelta está entera");
  CHECK(sdring_slot_seq(&r, 7) == 27, "la ranura 7 tiene la 27 (la 7 se rotó)");

  /* Corte de energía a mitad de la ventana 47 (ranura 7): 10 bloques y nada más. */
  writes_left = 10;
  CHECK(write_window(&r, 47) == SDRING_E_IO, "el corte se nota");
  writes_left = -1;
  CHECK(sdring_open(&r, &DEV, "SD-V2-M", SLOTS) == SDRING_OK && r.next_seq == 47, "la ranura cortada se reutiliza");
  CHECK(!slot_intact(27), "la ventana vieja de esa ranura queda marcada como dañada (CRC)");
  CHECK(slot_intact(46), "las demás no se tocan");
  CHECK(write_window(&r, 47) == SDRING_OK && slot_intact(47), "se reescribe bien");

  /* Corte justo en la ranura 0 (ventana 60). */
  for (uint32_t s = 48; s < 60; s++) write_window(&r, s);
  writes_left = 3;
  write_window(&r, 60);
  writes_left = -1;
  CHECK(sdring_open(&r, &DEV, "SD-V2-M", SLOTS) == SDRING_OK && r.next_seq == 60, "corte en la ranura 0");

  /* Tarjeta de otra estación: no se escribe nada. */
  uint8_t copia[SDRING_BLOCK];
  memcpy(copia, card[0], sizeof copia);
  CHECK(sdring_open(&r, &DEV, "SD-V1-Q1", SLOTS) == SDRING_E_OTHER, "otra estación se rechaza");
  CHECK(memcmp(copia, card[0], sizeof copia) == 0, "y no se toca");

  char ref[64];
  sdring_open(&r, &DEV, "SD-V2-M", SLOTS);
  sdring_ref(&r, 60, ref, sizeof ref);
  CHECK(strcmp(ref, "sd:SD-V2-M/00000060") == 0, "referencia para el registro");

  if (argc > 1) {
    write_window(&r, 60);
    FILE *f = fopen(argv[1], "wb");
    if (!f) return 3;
    fwrite(card, 1, sizeof card, f);
    fclose(f);
  }
  printf(fails ? "anillo: %d fallas\n" : "anillo: todo bien\n", fails);
  return fails ? 1 : 0;
}
