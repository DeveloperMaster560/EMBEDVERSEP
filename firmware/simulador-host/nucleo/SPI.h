/* SPI del simulador: cada byte va al chip cuyo CS está en LOW (lo maneja el
   programa con digitalWrite, como en la placa). Los chips se conectan desde el
   escenario: «#@ conectar MAX31865 cs=10». Sin chip seleccionado, MISO lee 0
   (y se avisa una vez): lo mismo que con el sensor desconectado. */
#pragma once
#include "Arduino.h"
#include "sim_dispositivos.h"
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
  uint8_t transfer(uint8_t b) { return sim::spi_intercambiar(b); }
  uint16_t transfer16(uint16_t v) {
    uint8_t h = transfer((uint8_t)(v >> 8)), l = transfer((uint8_t)v);
    return (uint16_t)((h << 8) | l);
  }
  void transfer(void *b, size_t n) { uint8_t *p = (uint8_t *)b; for (size_t i = 0; i < n; ++i) p[i] = transfer(p[i]); }
  void transfer(const void *tx, void *rx, size_t n, void * = nullptr) {
    for (size_t i = 0; i < n; ++i) {
      uint8_t r = transfer(tx ? ((const uint8_t *)tx)[i] : 0xFF);
      if (rx) ((uint8_t *)rx)[i] = r;
    }
  }
  void transferBytes(const uint8_t *tx, uint8_t *rx, uint32_t n) { transfer(tx, rx, n); }
  void writeBytes(const uint8_t *tx, uint32_t n) { transfer(tx, nullptr, n); }
 private:
  int n_;
};
extern SPIClass SPI;
