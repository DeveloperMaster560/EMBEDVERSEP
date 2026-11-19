/* 1-Wire imitado a nivel de biblioteca: su protocolo depende de tiempos de
   microsegundos (y la biblioteca real usa registros de cada placa). En el bus
   no hay ningún dispositivo: quien lo use directamente no encuentra nada.
   Para el DS18B20, ver DallasTemperature.h. */
#pragma once
#include "Arduino.h"
class OneWire {
 public:
  OneWire() {}
  explicit OneWire(uint8_t pin) : pin_(pin) {}
  void begin(uint8_t pin) { pin_ = pin; }
  uint8_t reset() { sim::nota("OneWire usado directamente: el simulador no tiene dispositivos 1-Wire en el bus"); return 0; }
  void select(const uint8_t *) {}
  void skip() {}
  void write(uint8_t, uint8_t = 0) {}
  void write_bytes(const uint8_t *, uint16_t, bool = 0) {}
  uint8_t read() { return 0xFF; }
  void read_bytes(uint8_t *b, uint16_t n) { memset(b, 0xFF, n); }
  void write_bit(uint8_t) {}
  uint8_t read_bit() { return 1; }
  void depower() {}
  void reset_search() {}
  void target_search(uint8_t) {}
  bool search(uint8_t *, bool = true) { return false; }
  static uint8_t crc8(const uint8_t *d, uint8_t n) {
    uint8_t c = 0;
    while (n--) { uint8_t b = *d++; for (uint8_t i = 8; i; i--) { uint8_t m = (c ^ b) & 1; c >>= 1; if (m) c ^= 0x8C; b >>= 1; } }
    return c;
  }
  uint8_t pin_ = 0;
};
