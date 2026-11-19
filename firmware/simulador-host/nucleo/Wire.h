/* Wire (I2C) del simulador: un TwoWire de verdad (es un Stream, como en la
   placa) cuyas transacciones llegan a los modelos de chip (sim_i2c.h). La
   biblioteca REAL del sensor habla con él igual que con el bus físico. */
#pragma once
#include "Arduino.h"
#include "sim_i2c.h"

/* El búfer real de cada familia: en AVR solo caben 32 bytes por transacción
   (fuente clásica de errores al pasar un sketch de ESP32 a un Uno). */
#if defined(ARDUINO_ARCH_ESP32) || defined(ARDUINO_ARCH_ESP8266)
#define I2C_BUFFER_LENGTH 128
#elif defined(ARDUINO_ARCH_RP2040) || defined(ARDUINO_ARCH_SAMD)
#define I2C_BUFFER_LENGTH 256
#else
#define I2C_BUFFER_LENGTH 32
#endif
#define BUFFER_LENGTH I2C_BUFFER_LENGTH
#define WIRE_HAS_END 1

class TwoWire : public Stream {
 public:
  explicit TwoWire(int n = 0) : n_(n) {}
  bool begin() { activo_ = true; return true; }
  template <class A, class B> bool begin(A, B, uint32_t = 0) { activo_ = true; return true; }
  bool begin(uint8_t) { sim::nota("Wire.begin(dirección): el simulador no imita la placa como esclava I2C"); return false; }
  bool begin(int d) { return begin((uint8_t)d); }
  bool end() { activo_ = false; return true; }
  bool setClock(uint32_t) { return true; }
  uint32_t getClock() { return 100000; }
  void setWireTimeout(uint32_t = 25000, bool = false) {}
  void setTimeOut(uint16_t) {}
  uint16_t getTimeOut() { return 50; }

  template <class A> void beginTransmission(A direccion) {
    dir_ = (uint8_t)direccion;
    ntx_ = 0;
    transmitiendo_ = true;
  }
  /* 0 bien · 1 datos demasiado largos · 2 NACK en la dirección · 3 NACK en los datos */
  uint8_t endTransmission(bool parar = true) {
    (void)parar;
    transmitiendo_ = false;
    if (ntx_ > I2C_BUFFER_LENGTH) return 1;
    sim::ChipI2C *c = sim::chip_en(dir_);
    if (!c) sin_chip(dir_);
    if (!c || !c->presente()) return 2;
    return c->escribir(tx_, ntx_) ? 0 : 3;
  }
  uint8_t endTransmission(uint8_t parar) { return endTransmission((bool)parar); }
  uint8_t endTransmission(int parar) { return endTransmission((bool)parar); }

  template <class A, class N> uint8_t requestFrom(A direccion, N cantidad) { return pedir((uint8_t)direccion, (size_t)cantidad); }
  template <class A, class N, class S> uint8_t requestFrom(A direccion, N cantidad, S) { return pedir((uint8_t)direccion, (size_t)cantidad); }
  /* Variante AVR con registro interno: escribe el registro y luego lee. */
  uint8_t requestFrom(uint8_t direccion, uint8_t cantidad, uint32_t registro, uint8_t tam, uint8_t parar) {
    if (tam > 0) {
      beginTransmission(direccion);
      while (tam-- > 0) write((uint8_t)(registro >> (tam * 8)));
      endTransmission(false);
    }
    (void)parar;
    return pedir(direccion, cantidad);
  }

  size_t write(uint8_t b) override {
    if (!transmitiendo_) return 0;
    if (ntx_ < sizeof tx_) tx_[ntx_] = b;
    ++ntx_;
    return 1;
  }
  size_t write(const uint8_t *d, size_t n) override {
    for (size_t i = 0; i < n; ++i) write(d[i]);
    return n;
  }
  using Print::write;
  int available() override { return (int)(nrx_ - irx_); }
  int read() override { return irx_ < nrx_ ? rx_[irx_++] : -1; }
  int peek() override { return irx_ < nrx_ ? rx_[irx_] : -1; }
  void flush() override {}
  void onReceive(void (*)(int)) {}
  void onRequest(void (*)(void)) {}

 private:
  uint8_t pedir(uint8_t direccion, size_t n) {
    irx_ = nrx_ = 0;
    if (n > sizeof rx_) n = sizeof rx_;
    sim::ChipI2C *c = sim::chip_en(direccion);
    if (!c) sin_chip(direccion);
    if (!c || !c->presente()) return 0;
    nrx_ = c->leer(rx_, n);
    return (uint8_t)nrx_;
  }
  static void sin_chip(uint8_t d) {
    char t[160];
    snprintf(t, sizeof t, "I2C: nada responde en 0x%02X (no hay modelo de ese chip, o el escenario no tiene su columna): "
                          "la placa lo ve desconectado", d);
    sim::nota(t);
  }
  int n_;
  bool activo_ = false, transmitiendo_ = false;
  uint8_t dir_ = 0;
  uint8_t tx_[I2C_BUFFER_LENGTH + 32];
  size_t ntx_ = 0;
  uint8_t rx_[I2C_BUFFER_LENGTH];
  size_t nrx_ = 0, irx_ = 0;
};
extern TwoWire Wire;
extern TwoWire Wire1;
