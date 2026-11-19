/* SoftwareSerial en el PC: un puerto serie por el pin RX, al que llega lo que
   el escenario conecte ahí (#@ conectar GPS rx=4). La biblioteca real (del
   núcleo AVR) cuenta tiempos de bits a mano; aquí se imita su API, con su
   búfer de 64 bytes y un solo puerto escuchando a la vez. */
#pragma once
#include "Arduino.h"
class SoftwareSerial : public Stream {
 public:
  SoftwareSerial(uint8_t rx, uint8_t tx, bool invertido = false)
      : p_("rx" + std::to_string(rx)) { (void)tx; (void)invertido; }
  void begin(long baudios) { p_.begin((unsigned long)baudios); listen(); }
  bool listen() { bool cambio = activo_ != this; activo_ = this; return cambio; }
  bool isListening() { return activo_ == this; }
  bool stopListening() { if (activo_ == this) { activo_ = nullptr; return true; } return false; }
  bool overflow() { return p_.desbordado(); }
  void end() { stopListening(); }
  operator bool() { return true; }
  int available() override { return isListening() ? p_.available() : 0; }
  int read() override { return isListening() ? p_.read() : -1; }
  int peek() override { return isListening() ? p_.peek() : -1; }
  void flush() override {}
  size_t write(uint8_t c) override { return p_.write(c); }
  using Print::write;
 private:
  sim::PuertoSerie p_;
  static inline SoftwareSerial *activo_ = nullptr;
};
