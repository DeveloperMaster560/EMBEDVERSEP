/*
 * sdring.h - Anillo de ventanas sobre la microSD en crudo (sin FAT).
 *
 * PROPUESTA pendiente de ingeniería (ver FORMATO_BIN.md, «Organización en la
 * tarjeta»). Cada ventana es un archivo SHMW completo en una ranura fija de
 * SDRING_SLOT_BLOCKS bloques; la ranura es secuencia % ranuras. Un corte de
 * energía solo puede dañar la ranura que se estaba escribiendo, y sus CRC lo
 * delatan; las demás quedan intactas. No hay tabla que corromper.
 *
 * No conoce el hardware: trabaja sobre un dispositivo de bloques (el driver
 * SDMMC1 en la placa, un archivo de imagen en el ordenador).
 */
#ifndef SHM_SDRING_H
#define SHM_SDRING_H

#include <stddef.h>
#include <stdint.h>

#define SDRING_BLOCK 512u
/* 160 B de cabecera + 2000 × 3 × 4 B = 24 160 B → 48 bloques (24 576 B). */
#define SDRING_SLOT_BLOCKS 48u
/* Superbloque en el bloque 0; las ranuras empiezan alineadas a 1 MiB. */
#define SDRING_FIRST_SLOT_LBA 2048u
#define SDRING_MAGIC "SHMRING1"

typedef struct {
  /* 0 si terminó bien. `buf` tiene n × 512 bytes. */
  int (*read)(void *ctx, uint32_t lba, uint8_t *buf, uint32_t n);
  int (*write)(void *ctx, uint32_t lba, const uint8_t *buf, uint32_t n);
  uint32_t blocks;   /* capacidad del dispositivo en bloques */
  void *ctx;
} sdring_dev_t;

typedef struct {
  sdring_dev_t dev;
  uint32_t slots;
  uint32_t next_seq;   /* secuencia que toca escribir */
  uint8_t ok;
  char station_id[33];
} sdring_t;

typedef enum {
  SDRING_OK = 0,
  SDRING_E_IO = -1,
  SDRING_E_SMALL = -2,     /* la tarjeta no da para SDRING_MIN_SLOTS */
  SDRING_E_OTHER = -3,     /* la tarjeta es de otra estación: no se toca */
  SDRING_E_TOO_BIG = -4,
} sdring_err_t;

/* Mínimo razonable: 7 días de ventanas de 10 s (diseño técnico, retención). */
#define SDRING_MIN_SLOTS (7u * 8640u)

/*
 * Abre la tarjeta. Si está vacía (sin superbloque) la prepara para
 * `station_id`. Si es de otra estación devuelve SDRING_E_OTHER y no escribe
 * nada: mezclar datos de dos estaciones sería peor que no guardar.
 * Después de abrir, next_seq continúa tras la última ventana válida.
 */
int sdring_open(sdring_t *r, const sdring_dev_t *dev, const char *station_id, uint32_t min_slots);

/* Escribe una ventana (cabecera + datos) en la ranura de `seq`. */
int sdring_write(sdring_t *r, uint32_t seq, const uint8_t *hdr, size_t hdr_len, const uint8_t *data, size_t data_len);

/* Secuencia guardada en una ranura, o -1 si la ranura no tiene cabecera válida. */
int64_t sdring_slot_seq(sdring_t *r, uint32_t slot);

/* Referencia de la ventana para el registro JSON: «sd:<estación>/<secuencia>». */
void sdring_ref(const sdring_t *r, uint32_t seq, char *out, size_t cap);

#endif /* SHM_SDRING_H */
