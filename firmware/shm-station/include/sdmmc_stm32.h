/* sdmmc_stm32.h - microSD por SDMMC1 (probado en Renode; SIN PROBAR EN HARDWARE). */
#ifndef SHM_SDMMC_STM32_H
#define SHM_SDMMC_STM32_H

#include "sdring.h"

/*
 * Inicia la tarjeta (400 kHz, SD v2, bus de 4 bits, 12,5 MHz) y rellena `dev`
 * con lectura, escritura, estado y capacidad. 0 si quedó lista; <0 indica en
 * qué paso falló (-1 sin tarjeta, -2 no es SD v2, -4 no termina de iniciar…).
 */
int sdmmc_init(sdring_dev_t *dev);

/* Diagnóstico del último comando: índice, SDMMC_STA y RESP1. */
extern uint32_t g_sdmmc_last_cmd, g_sdmmc_last_sta, g_sdmmc_last_resp;

#endif /* SHM_SDMMC_STM32_H */
