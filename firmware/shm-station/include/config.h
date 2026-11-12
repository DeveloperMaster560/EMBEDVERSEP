/*
 * config.h - Parámetros de la estación dinámica SD.
 *
 * Cada valor dice de dónde sale. Los marcados PENDIENTE no los fija el diseño
 * de ingenierías y están puestos para que el firmware arranque; hay que
 * confirmarlos antes de llevarlo a la estación real.
 */
#ifndef SHM_CONFIG_H
#define SHM_CONFIG_H

/* Identidad. Se fija al compilar: make STATION_ID=SD-V1-Q1 */
#ifndef STATION_ID
#define STATION_ID "SD-V2-M"
#endif
#define FIRMWARE_VERSION "0.1.0-esqueleto"
#define RECORD_SCHEMA_VERSION "1.0"

/* Diseño técnico §3.1 y §10: 200 Hz, 3 ejes, ventanas para el registro. */
#define SAMPLE_RATE_HZ 200u
#define AXES 3u
/* Duración de la ventana de registro: PENDIENTE (la simulación usa 10 s). */
#define WINDOW_S 10u
#define WINDOW_SAMPLES (SAMPLE_RATE_HZ * WINDOW_S)

/* Rango del ADXL355: PENDIENTE de ingenierías (±2, ±4 u ±8 g). */
#define ACCEL_RANGE_G 2u
/*
 * Filtro antialias/decimación hasta 200 Hz: PENDIENTE. Mientras no esté,
 * se declara en el registro para que nadie lo tome por un dato filtrado.
 */
#define FILTER_ID "sin-filtro-pendiente"

/* Relojes. El cristal HSE no está definido: se arranca con el HSI interno
 * (64 MHz, valor de reset del STM32H743) y sin PLL. */
#define SYSCLK_HZ 64000000u
#define PCLK1_HZ SYSCLK_HZ
#define PCLK2_HZ SYSCLK_HZ

/* Puerto de servicio por el que salen los registros (USART3 / RS-485).
 * Provisional: el diseño los manda por Ethernet al gateway, y esa pila
 * (LwIP + protocolo) está sin escribir porque el protocolo está PENDIENTE. */
#define SERVICE_BAUD 115200u
/* GNSS por USART1. 9600 baudios es PENDIENTE de la hoja del receptor. */
#define GNSS_BAUD 9600u

/* Si no llega un PPS en este tiempo, se pierde el enganche (§10). */
#define PPS_TIMEOUT_MS 1500u

/* Watchdog interno IWDG1: unos 2 s con LSI de 32 kHz. */
#define IWDG_PRESCALER 4u   /* /64 */
#define IWDG_RELOAD 1000u

#endif /* SHM_CONFIG_H */
