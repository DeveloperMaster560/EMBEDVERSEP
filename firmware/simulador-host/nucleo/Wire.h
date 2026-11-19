#pragma once
#include "Arduino.h"
class TwoWire {
 public:
  bool begin() { return true; }
  bool begin(int, int, uint32_t = 0) { return true; }
  void setClock(uint32_t) {}
};
extern TwoWire Wire;
