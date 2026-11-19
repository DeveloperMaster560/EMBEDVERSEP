/* Funciones de avr-libc / newlib que usan el núcleo de Arduino y las
   bibliotecas, y que la biblioteca C del PC no trae. */
#pragma once
#ifdef __cplusplus
extern "C" {
#endif
char *itoa(int v, char *s, int base);
char *utoa(unsigned v, char *s, int base);
char *ltoa(long v, char *s, int base);
char *ultoa(unsigned long v, char *s, int base);
char *dtostrf(double v, signed char ancho, unsigned char decimales, char *s);
#ifdef __cplusplus
}
#endif
