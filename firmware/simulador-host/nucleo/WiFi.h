/* Wi-Fi simulado (API del ESP32): conecta 1 s (virtual) después de begin().
   Solo existe en placas con Wi-Fi: el lanzador no lo deja usar en las demás. */
#pragma once
#include "Arduino.h"
#ifndef SIM_WIFI
#error "Esta placa no tiene Wi-Fi con la API de WiFi.h (la del ESP32). Elige otra placa con --placa o quita el Wi-Fi."
#endif
#define WL_IDLE_STATUS 0
#define WL_CONNECTED 3
#define WL_DISCONNECTED 6
#define WIFI_STA 1
#define WIFI_AP 2
#define WIFI_AP_STA 3
#define WIFI_OFF 0

/* IPAddress real del núcleo, más toString() como en el ESP32. */
class SimIP : public IPAddress {
 public:
  SimIP(uint8_t a, uint8_t b, uint8_t c, uint8_t d) : IPAddress(a, b, c, d) {}
  String toString() const {
    char t[16];
    snprintf(t, sizeof t, "%u.%u.%u.%u", (*this)[0], (*this)[1], (*this)[2], (*this)[3]);
    return String(t);
  }
};

/* Cliente TCP: la imitación de PubSubClient no lo usa para nada real; otras
   bibliotecas que abran conexiones verán que no conecta. */
class WiFiClient : public Client {
 public:
  int connect(IPAddress, uint16_t) override { sim::nota("WiFiClient.connect: el simulador no abre conexiones TCP"); return 0; }
  int connect(const char *, uint16_t) override { sim::nota("WiFiClient.connect: el simulador no abre conexiones TCP"); return 0; }
  size_t write(uint8_t) override { return 0; }
  size_t write(const uint8_t *, size_t) override { return 0; }
  int available() override { return 0; }
  int read() override { return -1; }
  int read(uint8_t *, size_t) override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
  void stop() override {}
  uint8_t connected() override { return 0; }
  operator bool() override { return false; }
  void setInsecure() {}
};

class SimWiFi {
 public:
  void mode(int) {}
  void begin(const char *, const char * = nullptr) { inicio_ = sim::us(); empezado_ = true; }
  void disconnect(bool = false) {}
  void setAutoReconnect(bool) {}
  void setHostname(const char *) {}
  void setSleep(bool) {}
  int status() { return empezado_ && sim::us() - inicio_ >= 1000000ULL ? WL_CONNECTED : WL_DISCONNECTED; }
  bool isConnected() { return status() == WL_CONNECTED; }
  int RSSI() { return -55; }
  SimIP localIP() { return SimIP(10, 0, 0, 2); }
  String macAddress() { return String("02:00:00:00:00:01"); }
  String SSID() { return String("simulador"); }
 private:
  uint64_t inicio_ = 0;
  bool empezado_ = false;
};
extern SimWiFi WiFi;
