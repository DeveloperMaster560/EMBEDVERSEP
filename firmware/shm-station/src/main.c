/*
 * main.c - Estación dinámica SD del Viaducto de La Novena (STM32H743VIT6).
 *
 * Arranca la placa y cede todo a app.c, que es el mismo código que se
 * ejecuta en el ordenador con la placa simulada (sim_main.c + board_host.c).
 */
#include "app.h"
#include "board.h"
#include "stm32h7xx.h"

int main(void) {
  board_init();
  app_init();
  for (;;) {
    if (!app_step()) __WFI();
  }
}
