/* MQTT simulado: lo publicado sale por la salida estándar; el lanzador
   (simular.py) lo valida y, si se pide, lo reenvía al broker de verdad. */
#pragma once
#include "Arduino.h"
#include <functional>
class PubSubClient {
 public:
  PubSubClient() {}
  PubSubClient(Client &) {}
  PubSubClient &setClient(Client &) { return *this; }
  PubSubClient &setServer(const char *, uint16_t) { return *this; }
  PubSubClient &setCallback(std::function<void(char *, uint8_t *, unsigned int)>) { return *this; }
  bool setBufferSize(uint16_t n) { buf_ = n; return true; }
  PubSubClient &setSocketTimeout(uint16_t) { return *this; }
  PubSubClient &setKeepAlive(uint16_t) { return *this; }
  bool connect(const char *id) { return connect(id, nullptr, nullptr); }
  bool connect(const char *, const char *, const char *) { conectado_ = true; return true; }
  bool connect(const char *, const char *, const char *, const char *, uint8_t, bool, const char *) { conectado_ = true; return true; }
  bool connected() { return conectado_; }
  void disconnect() { conectado_ = false; }
  int state() { return conectado_ ? 0 : -1; }
  bool loop() { return conectado_; }
  bool subscribe(const char *, uint8_t = 0) { return true; }
  bool publish(const char *t, const char *p) { return publish(t, (const uint8_t *)p, (unsigned)strlen(p), false); }
  bool publish(const char *t, const char *p, bool r) { return publish(t, (const uint8_t *)p, (unsigned)strlen(p), r); }
  bool publish(const char *t, const uint8_t *p, unsigned n, bool = false) {
    if (!conectado_) return false;
    if (n + strlen(t) + 7 > buf_) {   /* igual que la biblioteca real: si no cabe, no se envía */
      sim::nota("PubSubClient: mensaje mayor que el búfer (setBufferSize); la placa real tampoco lo enviaría");
      return false;
    }
    sim::publicar(t, p, n);
    return true;
  }
 private:
  bool conectado_ = false;
  unsigned buf_ = 256;   /* el valor por defecto de PubSubClient */
};
