/* BH1750 simulado: columna «luz» (lux). begin() falla si la columna no existe
   en el escenario (= sensor no conectado). */
#pragma once
#include "Arduino.h"
class BH1750 {
 public:
  enum Mode { UNCONFIGURED = 0, CONTINUOUS_HIGH_RES_MODE = 0x10, CONTINUOUS_HIGH_RES_MODE_2 = 0x11,
              CONTINUOUS_LOW_RES_MODE = 0x13, ONE_TIME_HIGH_RES_MODE = 0x20 };
  BH1750(uint8_t = 0x23) {}
  bool begin(Mode = CONTINUOUS_HIGH_RES_MODE, uint8_t = 0x23, void * = nullptr) {
    double v;
    return sim::valor("luz", v) || hay_columna();
  }
  float readLightLevel() { double v; return sim::valor("luz", v) ? (float)v : -2.0f; }
  bool measurementReady(bool = false) { return true; }
 private:
  static bool hay_columna();
};
