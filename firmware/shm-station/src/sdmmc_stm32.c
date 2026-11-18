/*
 * sdmmc_stm32.c - microSD por SDMMC1 del STM32H743 (registros, sin HAL).
 *
 * PROBADO SOLO EN RENODE 1.16 (modelo STM32HSDMMC con tarjeta emulada,
 * renode/probar-sd.py); SIN PROBAR EN HARDWARE. Sigue el manual RM0433
 * (§ SDMMC) y la especificación SD «Physical Layer Simplified». Lo primero al
 * tener placa: `# microSD lista` en el arranque y renode/probar-sd.py
 * equivalente con una tarjeta real (shm_plataforma.tarjeta sobre su imagen).
 *
 * Decisiones:
 *  - Reloj: el firmware no usa PLL (HSI 64 MHz). SDMMC necesita pll1_q o
 *    pll2_r: se enciende PLL2 desde el HSI → 50 MHz. 400 kHz para iniciar la
 *    tarjeta y 12,5 MHz para datos (velocidad por defecto, margen ante el
 *    cableado, que está PENDIENTE).
 *  - Sin DMA: el FIFO se lee/escribe por sondeo con control de flujo por
 *    hardware (HWFC), que para el reloj de la tarjeta antes de un desbordamiento.
 *  - Solo tarjetas SD v2 (SDHC/SDXC y SDSC v2). Una v1 se rechaza: la
 *    especificación industrial pedida en el diseño no las incluye.
 *  - Pull-ups internos en CMD y D0..D3 por si la placa no los lleva
 *    (PENDIENTE del esquemático; con externos no estorban).
 */
#include "sdmmc_stm32.h"

#include <string.h>

#include "board.h"
#include "pinout.h"
#include "stm32h7xx.h"

#define KER_HZ 50000000u
#define DIV_INIT 63u          /* 50 MHz / (2 × 63) ≈ 397 kHz */
#define DIV_DATA 2u           /* 50 MHz / (2 × 2) = 12,5 MHz */
#define DATA_TIMEOUT_CK (KER_HZ / (2u * DIV_DATA) / 4u)   /* 250 ms en ciclos de SDMMC_CK */

#define R1_ERRORS 0xFDFFE008u /* bits de error del estado de tarjeta (R1) */
#define ST_TRAN 4u
#define ST_DATA 5u
#define ST_RCV 6u
#define ST_PRG 7u

#define CLR_ALL (SDMMC_ICR_CCRCFAILC | SDMMC_ICR_DCRCFAILC | SDMMC_ICR_CTIMEOUTC | SDMMC_ICR_DTIMEOUTC | \
                 SDMMC_ICR_TXUNDERRC | SDMMC_ICR_RXOVERRC | SDMMC_ICR_CMDRENDC | SDMMC_ICR_CMDSENTC |    \
                 SDMMC_ICR_DATAENDC | SDMMC_ICR_DBCKENDC | SDMMC_ICR_BUSYD0ENDC)

uint32_t g_sdmmc_last_cmd, g_sdmmc_last_sta, g_sdmmc_last_resp;
static uint32_t s_rca;
static uint8_t s_ccs;    /* 1: direcciones por bloque (SDHC/SDXC) */

enum { R_NONE, R_SHORT, R_SHORT_NOCRC, R_LONG };

static int expired(uint32_t start, uint32_t ms) { return (uint32_t)(board_millis() - start) > ms; }

/* Espera bloqueante corta sin depender del SysTick (antes de que corra). */
static void spin(uint32_t loops) {
  for (volatile uint32_t i = 0; i < loops; i++) {}
}

static int cmd(uint32_t idx, uint32_t arg, int resp, uint32_t extra) {
  SDMMC1->ICR = CLR_ALL;
  SDMMC1->ARG = arg;
  uint32_t wr = resp == R_NONE ? 0u : resp == R_SHORT ? 1u : resp == R_SHORT_NOCRC ? 2u : 3u;
  SDMMC1->CMD = (idx & SDMMC_CMD_CMDINDEX) | (wr << SDMMC_CMD_WAITRESP_Pos) | extra | SDMMC_CMD_CPSMEN;
  uint32_t done = resp == R_NONE ? SDMMC_STA_CMDSENT : (SDMMC_STA_CMDREND | SDMMC_STA_CCRCFAIL | SDMMC_STA_CTIMEOUT);
  /* El periférico corta solo a los 64 ciclos; esto es por si ni siquiera responde. */
  uint32_t t0 = board_millis();
  while (!(SDMMC1->STA & done)) {
    if (expired(t0, 20)) {
      g_sdmmc_last_cmd = idx;
      g_sdmmc_last_sta = SDMMC1->STA;
      g_sdmmc_last_resp = 0xFFFFFFFFu;
      return -1;
    }
  }
  uint32_t sta = SDMMC1->STA;
  g_sdmmc_last_cmd = idx;
  g_sdmmc_last_sta = sta;
  g_sdmmc_last_resp = SDMMC1->RESP1;
  SDMMC1->ICR = SDMMC_ICR_CMDSENTC | SDMMC_ICR_CMDRENDC;
  if (sta & SDMMC_STA_CTIMEOUT) return -1;
  if (sta & SDMMC_STA_CCRCFAIL) return -2;
  return 0;
}

/* CMD con respuesta R1: además comprueba los bits de error de la tarjeta. */
static int cmd_r1(uint32_t idx, uint32_t arg, uint32_t extra) {
  int e = cmd(idx, arg, R_SHORT, extra);
  if (e) return e;
  return (SDMMC1->RESP1 & R1_ERRORS) ? -3 : 0;
}

static int status(uint32_t *state, int *ready_for_data) {
  if (cmd_r1(13, s_rca << 16, 0) != 0) return -1;
  *state = (SDMMC1->RESP1 >> 9) & 0xFu;
  *ready_for_data = (SDMMC1->RESP1 >> 8) & 1u;
  return 0;
}

/* 1 lista, 0 programando, <0 fallo (tarjeta fuera o en un estado inesperado). */
static int sd_ready(void *ctx) {
  (void)ctx;
  uint32_t st;
  int rfd;
  if (status(&st, &rfd) != 0) return -1;
  /*
   * Lista = «tran» con READY_FOR_DATA. El modelo de Renode 1.16 se queda en
   * «data» (5) tras una lectura de un bloque, cuando una tarjeta real vuelve a
   * «tran»; como este driver nunca deja una lectura a medias, «data» con
   * READY_FOR_DATA también cuenta como lista.
   */
  if ((st == ST_TRAN || st == ST_DATA) && rfd) return 1;
  if (st == ST_PRG || st == ST_RCV || st == ST_TRAN) return 0;
  return -1;
}

static int wait_ready(uint32_t ms) {
  uint32_t t0 = board_millis();
  for (;;) {
    int r = sd_ready(0);
    if (r != 0) return r > 0 ? 0 : -1;
    if (expired(t0, ms)) return -1;
  }
}

static void data_setup(int to_host) {
  SDMMC1->DCTRL = SDMMC_DCTRL_FIFORST;
  SDMMC1->DCTRL = 0;
  SDMMC1->DTIMER = DATA_TIMEOUT_CK;
  SDMMC1->DLEN = 512u;
  SDMMC1->DCTRL = (9u << SDMMC_DCTRL_DBLOCKSIZE_Pos) | (to_host ? SDMMC_DCTRL_DTDIR : 0u);
}

#define DATA_ERR (SDMMC_STA_DCRCFAIL | SDMMC_STA_DTIMEOUT | SDMMC_STA_RXOVERR | SDMMC_STA_TXUNDERR)

static int read1(uint32_t lba, uint8_t *buf) {
  if (wait_ready(500) != 0) return -1;
  data_setup(1);
  if (cmd_r1(17, s_ccs ? lba : lba * 512u, SDMMC_CMD_CMDTRANS) != 0) return -1;
  uint32_t words = 0, v, t0 = board_millis();
  for (;;) {
    uint32_t sta = SDMMC1->STA;
    if (sta & DATA_ERR) break;
    if ((sta & SDMMC_STA_RXFIFOHF) && words + 8u <= 128u) {
      for (int k = 0; k < 8; k++, words++) { v = SDMMC1->FIFO; memcpy(buf + words * 4u, &v, 4); }
    } else if (sta & SDMMC_STA_DATAEND) {
      while (words < 128u && !(SDMMC1->STA & SDMMC_STA_RXFIFOE)) { v = SDMMC1->FIFO; memcpy(buf + words * 4u, &v, 4); words++; }
      break;
    }
    if (expired(t0, 300)) break;
  }
  uint32_t sta = SDMMC1->STA;
  SDMMC1->ICR = CLR_ALL;
  return (words == 128u && !(sta & DATA_ERR)) ? 0 : -1;
}

static int write1(uint32_t lba, const uint8_t *buf) {
  if (wait_ready(500) != 0) return -1;
  data_setup(0);
  if (cmd_r1(24, s_ccs ? lba : lba * 512u, SDMMC_CMD_CMDTRANS) != 0) return -1;
  uint32_t words = 0, v, t0 = board_millis();
  for (;;) {
    uint32_t sta = SDMMC1->STA;
    if (sta & DATA_ERR) break;
    if (sta & SDMMC_STA_DATAEND) break;
    if (words < 128u && (sta & SDMMC_STA_TXFIFOHE)) {
      for (int k = 0; k < 8; k++, words++) { memcpy(&v, buf + words * 4u, 4); SDMMC1->FIFO = v; }
    }
    if (expired(t0, 300)) break;
  }
  uint32_t sta = SDMMC1->STA;
  SDMMC1->ICR = CLR_ALL;
  /* La tarjeta sigue programando: quien escribe después pregunta con sd_ready. */
  return (words == 128u && (sta & SDMMC_STA_DATAEND) && !(sta & DATA_ERR)) ? 0 : -1;
}

static int sd_read(void *ctx, uint32_t lba, uint8_t *buf, uint32_t n) {
  (void)ctx;
  for (uint32_t i = 0; i < n; i++) if (read1(lba + i, buf + i * 512u) != 0) return -1;
  return 0;
}

static int sd_write(void *ctx, uint32_t lba, const uint8_t *buf, uint32_t n) {
  (void)ctx;
  for (uint32_t i = 0; i < n; i++) if (write1(lba + i, buf + i * 512u) != 0) return -1;
  return 0;
}

static void clocks_and_pins(void) {
  /* PLL2 desde el HSI: 64 MHz / M2=32 → 2 MHz; × N2=200 → VCO 400 MHz; / R2=8 → 50 MHz. */
  if (!(RCC->CR & RCC_CR_PLL2RDY)) {
    RCC->PLLCKSELR = (RCC->PLLCKSELR & ~RCC_PLLCKSELR_DIVM2) | (32u << RCC_PLLCKSELR_DIVM2_Pos);
    RCC->PLLCFGR = (RCC->PLLCFGR & ~(RCC_PLLCFGR_PLL2RGE | RCC_PLLCFGR_PLL2VCOSEL | RCC_PLLCFGR_PLL2FRACEN)) |
                   (1u << RCC_PLLCFGR_PLL2RGE_Pos) | RCC_PLLCFGR_DIVR2EN;
    RCC->PLL2DIVR = ((200u - 1u) << RCC_PLL2DIVR_N2_Pos) | ((2u - 1u) << RCC_PLL2DIVR_P2_Pos) |
                    ((2u - 1u) << RCC_PLL2DIVR_Q2_Pos) | ((8u - 1u) << RCC_PLL2DIVR_R2_Pos);
    RCC->CR |= RCC_CR_PLL2ON;
    uint32_t t0 = board_millis();
    while (!(RCC->CR & RCC_CR_PLL2RDY)) if (expired(t0, 10)) return;
  }
  RCC->D1CCIPR |= RCC_D1CCIPR_SDMMCSEL;            /* pll2_r_ck */
  RCC->AHB3ENR |= RCC_AHB3ENR_SDMMC1EN;
  RCC->AHB3RSTR |= RCC_AHB3RSTR_SDMMC1RST;
  RCC->AHB3RSTR &= ~RCC_AHB3RSTR_SDMMC1RST;

  GPIO_TypeDef *const ports[6] = { PIN_SDMMC_D0_PORT, PIN_SDMMC_D1_PORT, PIN_SDMMC_D2_PORT,
                                   PIN_SDMMC_D3_PORT, PIN_SDMMC_CK_PORT, PIN_SDMMC_CMD_PORT };
  const uint32_t pins[6] = { PIN_SDMMC_D0_PIN, PIN_SDMMC_D1_PIN, PIN_SDMMC_D2_PIN,
                             PIN_SDMMC_D3_PIN, PIN_SDMMC_CK_PIN, PIN_SDMMC_CMD_PIN };
  for (int i = 0; i < 6; i++) {
    GPIO_TypeDef *p = ports[i];
    uint32_t pin = pins[i];
    p->MODER = (p->MODER & ~(3u << (pin * 2))) | (2u << (pin * 2));
    p->OSPEEDR |= (3u << (pin * 2));
    if (i != 4) p->PUPDR = (p->PUPDR & ~(3u << (pin * 2))) | (1u << (pin * 2));   /* pull-up salvo CK */
    volatile uint32_t *afr = &p->AFR[pin >> 3];
    *afr = (*afr & ~(0xFu << ((pin & 7u) * 4))) | (12u << ((pin & 7u) * 4));
  }
}

static uint32_t capacity_blocks(void) {
  uint32_t r1 = SDMMC1->RESP1, r2 = SDMMC1->RESP2, r3 = SDMMC1->RESP3;
  if ((r1 >> 30) == 1u) {                     /* CSD v2: C_SIZE en [69:48] */
    uint32_t c = ((r2 & 0x3Fu) << 16) | (r3 >> 16);
    return (c + 1u) * 1024u;
  }
  uint32_t bl = (r2 >> 16) & 0xFu;            /* CSD v1 */
  uint32_t c = ((r2 & 0x3FFu) << 2) | (r3 >> 30);
  uint32_t mult = (r3 >> 15) & 7u;
  return ((c + 1u) << (mult + 2u)) << bl >> 9;
}

int sdmmc_init(sdring_dev_t *dev) {
  clocks_and_pins();
  SDMMC1->POWER = 0;
  SDMMC1->CLKCR = (DIV_INIT << SDMMC_CLKCR_CLKDIV_Pos) | SDMMC_CLKCR_HWFC_EN;
  SDMMC1->POWER = SDMMC_POWER_PWRCTRL;        /* encendido: la tarjeta recibe reloj */
  spin(200000u);                               /* > 74 ciclos de reloj de la tarjeta */

  s_rca = 0;
  if (cmd(0, 0, R_NONE, 0) != 0) return -1;
  /*
   * CMD8: la tarjeta debe aceptar 2,7–3,6 V (0x1__) y devolver el patrón 0xAA.
   * El modelo de Renode 1.16 contesta 0x100, sin patrón: se admite 0x00 como
   * patrón para poder probar en el emulador; cualquier otro valor es un fallo
   * del bus y se rechaza.
   */
  if (cmd(8, 0x1AAu, R_SHORT, 0) != 0) return -2;                   /* no es SD v2 */
  uint32_t r7 = SDMMC1->RESP1;
  if ((r7 & 0xF00u) != 0x100u || ((r7 & 0xFFu) != 0xAAu && (r7 & 0xFFu) != 0u)) return -2;

  uint32_t t0 = board_millis(), ocr = 0;
  do {
    if (cmd_r1(55, 0, 0) != 0) return -3;
    if (cmd(41, 0x40FF8000u, R_SHORT_NOCRC, 0) != 0) return -3;   /* HCS + 2,7–3,6 V; R3 sin CRC */
    ocr = SDMMC1->RESP1;
    if (expired(t0, 1000)) return -4;
  } while (!(ocr & 0x80000000u));
  s_ccs = (ocr >> 30) & 1u;

  if (cmd(2, 0, R_LONG, 0) != 0) return -5;                      /* CID */
  if (cmd(3, 0, R_SHORT, 0) != 0) return -5;                     /* RCA */
  s_rca = SDMMC1->RESP1 >> 16;
  if (cmd(9, s_rca << 16, R_LONG, 0) != 0) return -5;            /* CSD */
  dev->blocks = capacity_blocks();
  if (cmd_r1(7, s_rca << 16, 0) != 0) return -6;                 /* seleccionar */
  if (wait_ready(500) != 0) return -6;
  if (cmd_r1(55, s_rca << 16, 0) != 0 || cmd_r1(6, 2u, 0) != 0) return -7;   /* bus de 4 bits */
  if (!s_ccs && cmd_r1(16, 512u, 0) != 0) return -7;
  SDMMC1->CLKCR = (DIV_DATA << SDMMC_CLKCR_CLKDIV_Pos) | SDMMC_CLKCR_WIDBUS_0 | SDMMC_CLKCR_HWFC_EN;

  dev->read = sd_read;
  dev->write = sd_write;
  dev->ready = sd_ready;
  dev->ctx = 0;
  return 0;
}
