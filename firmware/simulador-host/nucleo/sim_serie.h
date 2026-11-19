/* Puerto serie hacia otro equipo (Serial1/Serial2 o SoftwareSerial). Lo que
   llega se guarda en un búfer del tamaño del de la placa: si el programa no
   lee a tiempo, los bytes que no caben se pierden, como en la placa. */
#pragma once
#include <deque>
#include <string>
#include <utility>
#include "Stream.h"
#include "sim_dispositivos.h"

#ifndef SIM_BUFER_SERIE
#if defined(ARDUINO_ARCH_ESP32)
#define SIM_BUFER_SERIE 256
#else
#define SIM_BUFER_SERIE 64
#endif
#endif

namespace sim {
class PuertoSerie {
 public:
  explicit PuertoSerie(std::string nombre) : nombre_(std::move(nombre)) {}
  void begin(unsigned long baudios);
  int available();
  int read();
  int peek();
  size_t write(uint8_t c);
  void flush();
  bool desbordado() { bool d = perdidos_ > avisados_; avisados_ = perdidos_; return d; }
  const std::string &nombre() const { return nombre_; }
 private:
  void llenar();
  EquipoSerie *equipo();
  std::string nombre_;
  EquipoSerie *eq_ = nullptr;
  bool avisado_vacio_ = false;
  unsigned long baudios_ = 0;
  std::deque<std::pair<uint64_t, uint8_t>> en_camino_;
  std::deque<uint8_t> bufer_;
  uint64_t salida_us_ = 0;
  unsigned long perdidos_ = 0, avisados_ = 0;
};
}  // namespace sim
