/*
 * board.h - Acceso a los periféricos del STM32H743VIT6 de la estación.
 */
#ifndef SHM_BOARD_H
#define SHM_BOARD_H

#include <stddef.h>
#include <stdint.h>

void board_init(void);
uint32_t board_millis(void);

/* Transferencia SPI1 con el ADXL355 (CS = ACC_CS_N). Devuelve 0 si terminó. */
int accel_spi_transfer(const uint8_t *tx, uint8_t *rx, size_t n);

void service_write(const char *s, size_t n);   /* USART3: registros */
int gnss_read_char(char *c);                    /* USART1: NMEA, desde la cola de RX */

int pwr_good_level(void);
int storage_ok(void);                           /* microSD lista */
void watchdog_kick(void);                       /* IWDG1 + pulso en WDG_KICK */

/* Ganchos que llaman las interrupciones. */
extern volatile uint32_t g_tick_flag;           /* SysTick a SAMPLE_RATE_HZ */
extern volatile uint32_t g_pps_ms;              /* hora del último flanco PPS */
extern volatile uint32_t g_pps_count;

#endif /* SHM_BOARD_H */
