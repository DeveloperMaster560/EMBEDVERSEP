/* DS18B20 (y familia) imitado a nivel de biblioteca (1-Wire, ver OneWire.h).
   Escenario: columna «ds18b20» para el sensor 0, «ds18b20_1», «ds18b20_2»…
   para los siguientes (°C). Celda vacía o columna inexistente = sensor
   desconectado: devuelve -127, DEVICE_DISCONNECTED_C, como la biblioteca real.
   El número de sensores en el bus = columnas ds18b20* del escenario. */
#pragma once
#include <string>
#include "Arduino.h"
#include "OneWire.h"
#define DEVICE_DISCONNECTED_C -127
#define DEVICE_DISCONNECTED_F -196.6
#define DEVICE_DISCONNECTED_RAW -7040
typedef uint8_t DeviceAddress[8];
class DallasTemperature {
 public:
  DallasTemperature() {}
  explicit DallasTemperature(OneWire *) {}
  DallasTemperature(OneWire *, uint8_t) {}
  void setOneWire(OneWire *) {}
  void begin() {
    n_ = 0;
    while (n_ < 16 && sim::hay_columna(columna(n_))) ++n_;
    if (!n_) sim::nota("DallasTemperature: el escenario no tiene columna ds18b20: no hay sensores en el bus");
  }
  uint8_t getDeviceCount() { return n_; }
  uint8_t getDS18Count() { return n_; }
  bool getAddress(uint8_t *a, uint8_t i) {
    if (i >= n_) return false;
    uint8_t d[8] = {0x28, 0x53, 0x49, 0x4D, 0, 0, i, 0};   /* familia 0x28 (DS18B20), resto ficticio «SIM» */
    d[7] = OneWire::crc8(d, 7);
    memcpy(a, d, 8);
    return true;
  }
  bool isConnected(const uint8_t *a) { return a[6] < n_; }
  void setResolution(uint8_t r) { bits_ = r; }
  void setResolution(const uint8_t *, uint8_t r, bool = false) { bits_ = r; }
  uint8_t getResolution() { return bits_; }
  void setWaitForConversion(bool e) { esperar_ = e; }
  bool getWaitForConversion() { return esperar_; }
  bool isConversionComplete() { return sim::us() >= listo_us_; }
  /* Conversión: 94/188/375/750 ms según la resolución (9-12 bits), como el chip. */
  void requestTemperatures() {
    uint64_t ms = 750 >> (12 - (bits_ < 9 ? 9 : bits_ > 12 ? 12 : bits_));
    listo_us_ = sim::us() + ms * 1000;
    if (esperar_) delay(ms);
  }
  bool requestTemperaturesByIndex(uint8_t) { requestTemperatures(); return true; }
  bool requestTemperaturesByAddress(const uint8_t *) { requestTemperatures(); return true; }
  float getTempCByIndex(uint8_t i) {
    double v;
    if (i >= n_ || !sim::valor(columna(i), v)) return DEVICE_DISCONNECTED_C;
    double paso = 0.0625 * (1 << (12 - (bits_ < 9 ? 9 : bits_ > 12 ? 12 : bits_)));
    return (float)(floor(v / paso) * paso);   /* resolución del chip */
  }
  float getTempC(const uint8_t *a) { return getTempCByIndex(a[6]); }
  float getTempFByIndex(uint8_t i) { float c = getTempCByIndex(i); return c == DEVICE_DISCONNECTED_C ? DEVICE_DISCONNECTED_F : c * 1.8f + 32; }
  float getTempF(const uint8_t *a) { return getTempFByIndex(a[6]); }
  static float toFahrenheit(float c) { return c * 1.8f + 32; }
 private:
  static std::string columna(uint8_t i) { return i == 0 ? std::string("ds18b20") : "ds18b20_" + std::to_string(i); }
  uint8_t n_ = 0, bits_ = 12;
  bool esperar_ = true;
  uint64_t listo_us_ = 0;
};
