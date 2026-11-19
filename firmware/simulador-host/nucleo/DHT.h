/* DHT11/DHT22 simulado: columnas «temperatura» y «humedad» del escenario. */
#pragma once
#include "Arduino.h"
#define DHT11 11
#define DHT22 22
#define DHT21 21
class DHT {
 public:
  DHT(uint8_t, uint8_t, uint8_t = 6) {}
  void begin(uint8_t = 55) {}
  float readTemperature(bool f = false, bool = false) {
    double v;
    if (!sim::valor("temperatura", v)) return NAN;
    return f ? (float)(v * 1.8 + 32) : (float)v;
  }
  float readHumidity(bool = false) { double v; return sim::valor("humedad", v) ? (float)v : NAN; }
};
