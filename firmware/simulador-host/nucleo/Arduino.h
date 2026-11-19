/*
 * Arduino en el PC.
 *
 * String, Print, Stream, Printable, Client e IPAddress son los REALES del
 * núcleo de Arduino (cores/arduino del núcleo AVR instalado): el sketch y las
 * bibliotecas se comportan con ellos como en la placa. Lo propio del
 * simulador es solo lo que toca hardware: reloj, pines, ADC, puertos serie.
 *
 * La placa la eligen las macros que pasa el lanzador (simular_placa.py):
 * ARDUINO_ARCH_ESP32, ARDUINO_ARCH_AVR, ARDUINO_ARCH_RP2040… y SIM_PRINTF
 * (Serial.printf existe en esa familia), SIM_BITS_ADC (resolución del ADC).
 * Diferencia que NO se imita: en AVR un int es de 16 bits; aquí, de 32.
 */
#pragma once
#include <ctype.h>
#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>
#include <string>

#include "avr/pgmspace.h"
#include "sim.h"
#include "WString.h"
#include "Printable.h"
#include "Print.h"
#include "Stream.h"
#include "IPAddress.h"
#include "Client.h"

#ifndef ARDUINO
#define ARDUINO 10819
#endif
#ifndef SIM_BITS_ADC
#define SIM_BITS_ADC 10
#endif

#define HIGH 0x1
#define LOW 0x0
#define INPUT 0x0
#define OUTPUT 0x1
#define INPUT_PULLUP 0x2
#define INPUT_PULLDOWN 0x3
#define CHANGE 1
#define FALLING 2
#define RISING 3
#define LSBFIRST 0
#define MSBFIRST 1
#define ADC_0db 0
#define ADC_2_5db 1
#define ADC_6db 2
#define ADC_11db 3
#ifndef PI
#define PI 3.1415926535897932384626433832795
#endif
#define HALF_PI 1.5707963267948966192313216916398
#define TWO_PI 6.283185307179586476925286766559
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105
#define radians(d) ((d) * DEG_TO_RAD)
#define degrees(r) ((r) * RAD_TO_DEG)
#define sq(x) ((x) * (x))
#define lowByte(w) ((uint8_t)((w) & 0xff))
#define highByte(w) ((uint8_t)((w) >> 8))
#define bit(b) (1UL << (b))
#define bitRead(v, b) (((v) >> (b)) & 0x01)
#define bitSet(v, b) ((v) |= (1UL << (b)))
#define bitClear(v, b) ((v) &= ~(1UL << (b)))
#define bitWrite(v, b, x) ((x) ? bitSet(v, b) : bitClear(v, b))
#define interrupts()
#define noInterrupts()
#define digitalPinToInterrupt(p) (p)
#define IRAM_ATTR
#define ICACHE_RAM_ATTR
#define ARDUINO_ISR_ATTR
typedef bool boolean;
typedef uint8_t byte;
typedef uint16_t word;

#if defined(ARDUINO_ARCH_AVR)
#define LED_BUILTIN 13
enum { A0 = 14, A1, A2, A3, A4, A5, A6, A7 };
#elif defined(ARDUINO_ARCH_ESP32)
#define LED_BUILTIN 2
enum { A0 = 36, A3 = 39, A4 = 32, A5 = 33, A6 = 34, A7 = 35 };
#elif defined(ARDUINO_ARCH_RP2040)
#define LED_BUILTIN 25
enum { A0 = 26, A1, A2, A3 };
#elif defined(ARDUINO_ARCH_STM32)
/* Pines por nombre: PA0..PA15 = 0..15, PB0.. = 16.., PC0.. = 32.. (columna A<n> del escenario). */
enum { PA0, PA1, PA2, PA3, PA4, PA5, PA6, PA7, PA8, PA9, PA10, PA11, PA12, PA13, PA14, PA15,
       PB0, PB1, PB2, PB3, PB4, PB5, PB6, PB7, PB8, PB9, PB10, PB11, PB12, PB13, PB14, PB15,
       PC0, PC1, PC2, PC3, PC4, PC5, PC6, PC7, PC8, PC9, PC10, PC11, PC12, PC13, PC14, PC15 };
#define LED_BUILTIN PC13
enum { A0 = PA0, A1, A2, A3, A4, A5, A6, A7 };
#else
#define LED_BUILTIN 13
enum { A0 = 14, A1, A2, A3, A4, A5 };
#endif

/* Acceso rápido a puertos (lo usan Adafruit BusIO y otras): en el PC es un
   registro que no va a ningún pin. Los pines se manejan con digitalWrite. */
extern volatile uint32_t sim_registro_puerto;
#define digitalPinToPort(p) (0)
#define digitalPinToBitMask(p) (1UL << ((p) & 31))
#define portOutputRegister(port) (&sim_registro_puerto)
#define portInputRegister(port) (&sim_registro_puerto)
#define portModeRegister(port) (&sim_registro_puerto)

template <class A, class B> inline auto min(A a, B b) -> decltype(a < b ? a : b) { return a < b ? a : b; }
template <class A, class B> inline auto max(A a, B b) -> decltype(a > b ? a : b) { return a > b ? a : b; }
template <class T, class L, class H> inline T constrain(T x, L lo, H hi) { return x < lo ? (T)lo : (x > hi ? (T)hi : x); }
#define _min(a, b) min(a, b)
#define _max(a, b) max(a, b)

/* El sketch pide la hora con gettimeofday(): se le da la del reloj virtual. */
int sim_gettimeofday(struct timeval *tv, void *);
#define gettimeofday sim_gettimeofday

/* Puerto serie. Serial = el USB: lo que escribe sale por la consola.
   Serial1/Serial2 = UART hacia otros equipos: en el simulador no hay nada
   conectado (se avisa, y read() da -1). */
class HardwareSerial : public Stream {
 public:
  explicit HardwareSerial(int n) : n_(n) {}
  template <class... A> void begin(unsigned long, A...) { if (n_ > 0) sim::nota("Serial1/Serial2: en el simulador no hay nada conectado a ese puerto"); }
  void end() {}
  operator bool() const { return true; }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override { fflush(stdout); }
  size_t write(uint8_t c) override { if (n_ == 0) { fputc(c, stdout); if (c == '\n') fflush(stdout); } return 1; }
  size_t write(const uint8_t *b, size_t n) override { if (n_ == 0) fwrite(b, 1, n, stdout); return n; }
  using Print::write;
#ifdef SIM_PRINTF
  int printf(const char *f, ...) __attribute__((format(printf, 2, 3))) {
    char b[512];
    va_list a;
    va_start(a, f);
    int r = vsnprintf(b, sizeof b, f, a);
    va_end(a);
    write((const uint8_t *)b, strlen(b));
    fflush(stdout);
    return r;
  }
#endif
 private:
  int n_;
};
extern HardwareSerial Serial;
extern HardwareSerial Serial1;
extern HardwareSerial Serial2;
typedef HardwareSerial SimSerial;   /* nombre antiguo, para las imitaciones */

#if defined(ARDUINO_ARCH_ESP32) || defined(ARDUINO_ARCH_ESP8266)
class SimEsp {
 public:
  uint32_t getFreeHeap() { return 200000; }
  void restart() { sim::nota("ESP.restart() pedido por el sketch"); exit(0); }
  uint64_t getEfuseMac() { return 0x0100000000AAULL; }
  uint32_t getChipId() { return 0xAA; }
};
extern SimEsp ESP;
#endif

unsigned long millis();
unsigned long micros();
void delay(unsigned long ms);
void delayMicroseconds(unsigned int us);
void yield();
void pinMode(uint8_t pin, uint8_t modo);
void digitalWrite(uint8_t pin, uint8_t v);
int digitalRead(uint8_t pin);
int analogRead(uint8_t pin);
void analogReadResolution(uint8_t bits);
void analogWrite(uint8_t pin, int v);
void analogSetPinAttenuation(uint8_t pin, int at);
void analogSetAttenuation(int at);
unsigned long pulseIn(uint8_t pin, uint8_t estado, unsigned long timeout_us = 1000000UL);
unsigned long pulseInLong(uint8_t pin, uint8_t estado, unsigned long timeout_us = 1000000UL);
void attachInterrupt(uint8_t pin, void (*f)(void), int modo);
void detachInterrupt(uint8_t pin);
void tone(uint8_t pin, unsigned int frecuencia, unsigned long duracion = 0);
void noTone(uint8_t pin);
void shiftOut(uint8_t datos, uint8_t reloj, uint8_t orden, uint8_t valor);
uint8_t shiftIn(uint8_t datos, uint8_t reloj, uint8_t orden);
long map(long x, long in_min, long in_max, long out_min, long out_max);
long random(long max);
long random(long min, long max);
void randomSeed(unsigned long semilla);
inline uint16_t makeWord(uint8_t h, uint8_t l) { return (uint16_t)((h << 8) | l); }

/* API propia de cada familia (lo que las bibliotecas usan según la placa). */
#if defined(ARDUINO_ARCH_ESP32)
/* Núcleo ESP32 3.x (ESP-IDF 5): PWM «ledc» por pin. En el PC no va a ningún pin. */
#define ESP_IDF_VERSION_VAL(mayor, menor, parche) (((mayor) << 16) | ((menor) << 8) | (parche))
#define ESP_IDF_VERSION ESP_IDF_VERSION_VAL(5, 1, 4)
#define ESP_ARDUINO_VERSION_VAL(mayor, menor, parche) (((mayor) << 16) | ((menor) << 8) | (parche))
#define ESP_ARDUINO_VERSION ESP_ARDUINO_VERSION_VAL(3, 0, 7)
inline bool ledcAttach(uint8_t, uint32_t, uint8_t) { return true; }
inline bool ledcAttachChannel(uint8_t, uint32_t, uint8_t, uint8_t) { return true; }
inline bool ledcDetach(uint8_t) { return true; }
inline bool ledcWrite(uint8_t, uint32_t) { return true; }
inline uint32_t ledcWriteTone(uint8_t, uint32_t f) { return f; }
inline uint32_t ledcRead(uint8_t) { return 0; }
#endif
#if defined(ARDUINO_ARCH_STM32)
inline void noTone(uint8_t pin, bool) { noTone(pin); }
#endif

/* Lo que el sketch define: setup() y loop(). */
void setup();
void loop();
