/* avr/pgmspace.h para el PC: en una placa AVR la flash es otro espacio de
   direcciones; aquí todo es memoria normal. Lo usan el String/Print reales del
   núcleo de Arduino y muchas bibliotecas. */
#pragma once
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include "../sim_libc.h"
#define PROGMEM
#define PGM_P const char *
#define PGM_VOID_P const void *
#define PSTR(s) (s)
typedef char prog_char;
typedef uint8_t prog_uchar;
#define pgm_read_byte(p) (*(const uint8_t *)(p))
#define pgm_read_word(p) (*(const uint16_t *)(p))
#define pgm_read_dword(p) (*(const uint32_t *)(p))
#define pgm_read_float(p) (*(const float *)(p))
#define pgm_read_ptr(p) (*(void *const *)(p))
#define pgm_read_byte_near(p) pgm_read_byte(p)
#define pgm_read_word_near(p) pgm_read_word(p)
#define pgm_read_byte_far(p) pgm_read_byte(p)
#define strlen_P strlen
#define strcpy_P strcpy
#define strncpy_P strncpy
#define strcmp_P strcmp
#define strncmp_P strncmp
#define strcasecmp_P strcasecmp
#define strstr_P strstr
#define strcat_P strcat
#define memcpy_P memcpy
#define memcmp_P memcmp
#define sprintf_P sprintf
#define snprintf_P snprintf
#define vsnprintf_P vsnprintf
#define printf_P printf
