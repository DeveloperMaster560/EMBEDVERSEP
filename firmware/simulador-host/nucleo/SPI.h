/* SPI del simulador: el bus existe, pero aún no hay modelos de chip SPI.
   Una transferencia sin chip devuelve 0 (y se avisa una vez): el programa ve
   lo mismo que con el sensor desconectado. */
#pragma once
#include "Arduino.h"
#define SPI_MODE0 0x00
#define SPI_MODE1 0x01
#define SPI_MODE2 0x02
#define SPI_MODE3 0x03
#define SPI_MSBFIRST 1
#define SPI_LSBFIRST 0
#define SPI_CLOCK_DIV2 0x04
#define SPI_CLOCK_DIV4 0x00
#define SPI_CLOCK_DIV8 0x05
#define SPI_CLOCK_DIV16 0x01
#define SPI_CLOCK_DIV32 0x06
#define SPI_CLOCK_DIV64 0x02
#define SPI_CLOCK_DIV128 0x03
typedef uint8_t BitOrder;
class SPISettings {
 public:
  SPISettings() {}
  SPISettings(uint32_t, uint8_t, uint8_t) {}
};
class SPIClass {
 public:
  explicit SPIClass(int n = 0) : n_(n) {}
  void begin() {}
  void begin(int8_t, int8_t, int8_t = -1, int8_t = -1) {}
  void end() {}
  void beginTransaction(SPISettings) {}
  void endTransaction() {}
  void usingInterrupt(int) {}
  void setBitOrder(uint8_t) {}
  void setDataMode(uint8_t) {}
  void setClockDivider(uint8_t) {}
  void setFrequency(uint32_t) {}
  uint8_t transfer(uint8_t) { sin_chip(); return 0; }
  uint16_t transfer16(uint16_t) { sin_chip(); return 0; }
  void transfer(void *b, size_t n) { sin_chip(); memset(b, 0, n); }
  void transfer(const void *, void *rx, size_t n, void * = nullptr) { sin_chip(); if (rx) memset(rx, 0, n); }
  void transferBytes(const uint8_t *, uint8_t *rx, uint32_t n) { sin_chip(); if (rx) memset(rx, 0, n); }
  void writeBytes(const uint8_t *, uint32_t) { sin_chip(); }
 private:
  static void sin_chip() { sim::nota("SPI: el simulador aún no tiene modelos de chip SPI; las lecturas dan 0"); }
  int n_;
};
extern SPIClass SPI;
