/* board_host.h - Mandos de la placa simulada (solo en el ordenador). */
#ifndef SHM_BOARD_HOST_H
#define SHM_BOARD_HOST_H

#include "board.h"
#include "config.h"

int host_load_feed(const char *path);              /* devuelve muestras cargadas */
void host_set_disconnected(int on);                /* ADXL355 fuera del bus */
void host_set_fixed_g(int on, double x, double y, double z);
void host_gnss_write(const char *s);               /* caracteres hacia USART1 */
void host_pps(void);                               /* flanco PPS */
void host_tick(void);                              /* un periodo de SysTick */
/* microSD simulada en un archivo de imagen (se crea disperso si no existe). */
int host_set_sd_image(const char *path, uint32_t megabytes);
void host_set_sd_failing(int on);                  /* la tarjeta deja de aceptar escrituras */

#endif /* SHM_BOARD_HOST_H */
