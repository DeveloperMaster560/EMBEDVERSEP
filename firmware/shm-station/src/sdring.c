/*
 * sdring.c - Anillo de ventanas sobre la microSD en crudo (ver sdring.h).
 *
 * Orden de escritura de una ranura: primero los bloques 1..47 y AL FINAL el
 * bloque 0, que lleva la cabecera. Si la energía se va a mitad, el bloque 0
 * conserva la cabecera vieja (de la vuelta anterior, o nada): al arrancar,
 * esa ranura no cuenta como escrita y se vuelve a usar. Un lector que la
 * abra verá que el CRC de los datos no cuadra.
 */
#include "sdring.h"

#include <stdio.h>
#include <string.h>

#include "shmbin.h"
#include "station.h"

static uint8_t s_blk[SDRING_BLOCK];

static uint32_t rd32(const uint8_t *p) { return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24; }
static void wr32(uint8_t *p, uint32_t v) { for (int i = 0; i < 4; i++) p[i] = (uint8_t)(v >> (8 * i)); }

/* Superbloque: magic[8] versión slot_blocks first_lba slots station_id[32] … crc32 en 508. */
static int read_super(sdring_t *r) {
  if (r->dev.read(r->dev.ctx, 0, s_blk, 1) != 0) return SDRING_E_IO;
  if (memcmp(s_blk, SDRING_MAGIC, 8) != 0) return 1;                     /* vacía */
  if (crc32_ieee(s_blk, 508) != rd32(s_blk + 508)) return 1;             /* ilegible: como vacía */
  if (rd32(s_blk + 8) != 1 || rd32(s_blk + 12) != SDRING_SLOT_BLOCKS || rd32(s_blk + 16) != SDRING_FIRST_SLOT_LBA) {
    return SDRING_E_OTHER;                                                 /* otro formato: no se toca */
  }
  if (strncmp((const char *)s_blk + 24, r->station_id, 32) != 0) return SDRING_E_OTHER;
  r->slots = rd32(s_blk + 20);
  return 0;
}

static int write_super(sdring_t *r) {
  memset(s_blk, 0, sizeof s_blk);
  memcpy(s_blk, SDRING_MAGIC, 8);
  wr32(s_blk + 8, 1);
  wr32(s_blk + 12, SDRING_SLOT_BLOCKS);
  wr32(s_blk + 16, SDRING_FIRST_SLOT_LBA);
  wr32(s_blk + 20, r->slots);
  memcpy(s_blk + 24, r->station_id, strlen(r->station_id));
  wr32(s_blk + 508, crc32_ieee(s_blk, 508));
  return r->dev.write(r->dev.ctx, 0, s_blk, 1) == 0 ? SDRING_OK : SDRING_E_IO;
}

int64_t sdring_slot_seq(sdring_t *r, uint32_t slot) {
  if (slot >= r->slots) return -1;
  if (r->dev.read(r->dev.ctx, SDRING_FIRST_SLOT_LBA + slot * SDRING_SLOT_BLOCKS, s_blk, 1) != 0) return -1;
  if (memcmp(s_blk, SHMBIN_MAGIC, 4) != 0) return -1;
  if (crc32_ieee(s_blk, 156) != rd32(s_blk + 156)) return -1;
  if (strncmp((const char *)s_blk + 48, r->station_id, 32) != 0) return -1;
  uint32_t seq = rd32(s_blk + 24);
  return seq % r->slots == slot ? (int64_t)seq : -1;
}

/*
 * Las secuencias, recorriendo las ranuras, suben y luego caen una vez (la
 * vuelta anterior) o se acaban (ranuras sin escribir). Búsqueda binaria del
 * último elemento de la vuelta actual: unas 16 lecturas para una tarjeta de 32 GB.
 */
static uint32_t find_next(sdring_t *r) {
  int64_t first = sdring_slot_seq(r, 0);
  if (first < 0) {
    /* La ranura 0 está vacía o se cortó al escribirla: lo último es la final. */
    int64_t last = sdring_slot_seq(r, r->slots - 1);
    return last < 0 ? 0u : (uint32_t)last + 1u;
  }
  uint32_t lo = 0, hi = r->slots - 1;   /* lo cumple; buscar el último que cumple */
  while (lo < hi) {
    uint32_t mid = lo + (hi - lo + 1) / 2;
    int64_t s = sdring_slot_seq(r, mid);
    if (s >= first) lo = mid; else hi = mid - 1;
  }
  return (uint32_t)sdring_slot_seq(r, lo) + 1u;
}

int sdring_open(sdring_t *r, const sdring_dev_t *dev, const char *station_id, uint32_t min_slots) {
  memset(r, 0, sizeof *r);
  r->dev = *dev;
  snprintf(r->station_id, sizeof r->station_id, "%s", station_id);
  int e = read_super(r);
  if (e < 0) return e;
  if (e == 1) {
    if (dev->blocks <= SDRING_FIRST_SLOT_LBA) return SDRING_E_SMALL;
    r->slots = (dev->blocks - SDRING_FIRST_SLOT_LBA) / SDRING_SLOT_BLOCKS;
    if (r->slots < min_slots) return SDRING_E_SMALL;
    if ((e = write_super(r)) != SDRING_OK) return e;
  }
  r->next_seq = find_next(r);
  r->ok = 1;
  return SDRING_OK;
}

int sdring_begin(sdring_t *r, uint32_t seq, const uint8_t *hdr, size_t hdr_len, const uint8_t *data, size_t data_len) {
  if (!r->ok) return SDRING_E_IO;
  if (hdr_len + data_len > (size_t)SDRING_SLOT_BLOCKS * SDRING_BLOCK || hdr_len > SDRING_BLOCK) return SDRING_E_TOO_BIG;
  size_t first_data = SDRING_BLOCK - hdr_len;   /* lo que cabe de datos en el bloque 0 */
  size_t rest = data_len > first_data ? data_len - first_data : 0;
  r->w_hdr = hdr; r->w_hdr_len = hdr_len;
  r->w_data = data; r->w_data_len = data_len;
  r->w_seq = seq;
  r->w_blocks = 1u + (uint32_t)((rest + SDRING_BLOCK - 1) / SDRING_BLOCK);
  r->w_block = 1;      /* primero los datos (1..), el bloque 0 al final */
  r->w_busy = 1;
  return SDRING_BUSY;
}

static int fail(sdring_t *r) {
  r->w_busy = 0;
  return SDRING_E_IO;
}

int sdring_poll(sdring_t *r) {
  if (!r->w_busy) return SDRING_OK;
  if (r->dev.ready) {
    int rd = r->dev.ready(r->dev.ctx);
    if (rd < 0) return fail(r);
    if (rd == 0) return SDRING_BUSY;
  }
  uint32_t base = SDRING_FIRST_SLOT_LBA + (r->w_seq % r->slots) * SDRING_SLOT_BLOCKS;
  size_t first_data = SDRING_BLOCK - r->w_hdr_len;
  memset(s_blk, 0, sizeof s_blk);
  if (r->w_block == 0) {
    /* Último paso: la cabecera. Hasta aquí la ranura no cuenta como escrita. */
    if (r->w_block_done_header) {
      r->w_busy = 0;
      if (r->w_seq + 1u > r->next_seq) r->next_seq = r->w_seq + 1u;
      return SDRING_OK;
    }
    memcpy(s_blk, r->w_hdr, r->w_hdr_len);
    memcpy(s_blk + r->w_hdr_len, r->w_data, r->w_data_len < first_data ? r->w_data_len : first_data);
    if (r->dev.write(r->dev.ctx, base, s_blk, 1) != 0) return fail(r);
    r->w_block_done_header = 1;
    /* Con `ready`, se espera a que la tarjeta confirme antes de dar por buena la ranura. */
    if (r->dev.ready) return SDRING_BUSY;
    r->w_busy = 0;
    if (r->w_seq + 1u > r->next_seq) r->next_seq = r->w_seq + 1u;
    return SDRING_OK;
  }
  size_t off = first_data + (size_t)(r->w_block - 1) * SDRING_BLOCK;
  size_t n = r->w_data_len - off;
  if (n > SDRING_BLOCK) n = SDRING_BLOCK;
  memcpy(s_blk, r->w_data + off, n);
  if (r->dev.write(r->dev.ctx, base + r->w_block, s_blk, 1) != 0) return fail(r);
  r->w_block = r->w_block + 1u < r->w_blocks ? r->w_block + 1u : 0u;
  r->w_block_done_header = 0;
  return SDRING_BUSY;
}

int sdring_write(sdring_t *r, uint32_t seq, const uint8_t *hdr, size_t hdr_len, const uint8_t *data, size_t data_len) {
  int e = sdring_begin(r, seq, hdr, hdr_len, data, data_len);
  while (e == SDRING_BUSY) e = sdring_poll(r);
  return e;
}

void sdring_ref(const sdring_t *r, uint32_t seq, char *out, size_t cap) {
  snprintf(out, cap, "sd:%s/%08lu", r->station_id, (unsigned long)seq);
}
