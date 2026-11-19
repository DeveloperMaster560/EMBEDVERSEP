/* Wi-Fi simulado: conecta 1 s (virtual) después de begin(). */
#pragma once
#include "Arduino.h"
#define WL_IDLE_STATUS 0
#define WL_CONNECTED 3
#define WL_DISCONNECTED 6
#define WIFI_STA 1
class IPAddress {
 public:
  const char *toString() const { return "10.0.0.2"; }
};
inline SimSerial &operator<<(SimSerial &s, const IPAddress &) { return s; }
class SimWiFi {
 public:
  void mode(int) {}
  void begin(const char *, const char * = nullptr) { inicio_ = sim::us(); empezado_ = true; }
  void disconnect(bool = false) {}
  void setAutoReconnect(bool) {}
  int status() { return empezado_ && sim::us() - inicio_ >= 1000000ULL ? WL_CONNECTED : WL_DISCONNECTED; }
  bool isConnected() { return status() == WL_CONNECTED; }
  int RSSI() { return -55; }
  String localIP() { return String("10.0.0.2"); }
  String macAddress() { return String("02:00:00:00:00:01"); }
 private:
  uint64_t inicio_ = 0;
  bool empezado_ = false;
};
extern SimWiFi WiFi;

