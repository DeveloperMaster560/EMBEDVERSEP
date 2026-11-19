/* Arduino/ESP32 simulado en el PC (solo lo que usan los sketches del proyecto). */
#pragma once
#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <string>
#include "sim.h"

#define OUTPUT 1
#define INPUT 0
#define INPUT_PULLUP 2
#define LOW 0
#define HIGH 1
#define ADC_11db 3
#define ADC_0db 0
#define LED_BUILTIN 2
typedef bool boolean;
typedef uint8_t byte;

/* El sketch pide la hora con gettimeofday(): se le da la del reloj virtual. */
int sim_gettimeofday(struct timeval *tv, void *);
#define gettimeofday sim_gettimeofday

class String {
 public:
  String(const char *s = "") : s_(s ? s : "") {}
  String(const std::string &s) : s_(s) {}
  String(int v) : s_(std::to_string(v)) {}
  String(unsigned v) : s_(std::to_string(v)) {}
  String(long v) : s_(std::to_string(v)) {}
  String(unsigned long v) : s_(std::to_string(v)) {}
  String(double v, int dec = 2) { char b[64]; snprintf(b, sizeof b, "%.*f", dec, v); s_ = b; }
  const char *c_str() const { return s_.c_str(); }
  unsigned length() const { return (unsigned)s_.size(); }
  String &operator+=(const String &o) { s_ += o.s_; return *this; }
  friend String operator+(const String &a, const String &b) { return String(a.s_ + b.s_); }
  bool operator==(const String &o) const { return s_ == o.s_; }
  float toFloat() const { return (float)atof(s_.c_str()); }
  int toInt() const { return atoi(s_.c_str()); }
 private:
  std::string s_;
};

class SimSerial {
 public:
  void begin(unsigned long) {}
  operator bool() const { return true; }
  int available() { return 0; }
  int read() { return -1; }
  size_t print(const char *s) { return fputs(s, stdout) >= 0 ? strlen(s) : 0; }
  size_t print(const String &s) { return print(s.c_str()); }
  size_t print(double v, int d = 2) { return (size_t)printf("%.*f", d, v); }
  size_t print(int v) { return (size_t)printf("%d", v); }
  size_t print(long v) { return (size_t)printf("%ld", v); }
  size_t print(unsigned long v) { return (size_t)printf("%lu", v); }
  size_t print(unsigned v) { return (size_t)printf("%u", v); }
  template <typename T> size_t println(T v) { size_t n = print(v); fputs("\n", stdout); fflush(stdout); return n + 1; }
  template <typename T> size_t println(T v, int d) { size_t n = print(v, d); fputs("\n", stdout); fflush(stdout); return n + 1; }
  size_t println() { fputs("\n", stdout); return 1; }
  int printf(const char *f, ...) __attribute__((format(printf, 2, 3))) {
    va_list a; va_start(a, f); int r = vprintf(f, a); va_end(a); fflush(stdout); return r;
  }
};
extern SimSerial Serial;

class SimEsp {
 public:
  uint32_t getFreeHeap() { return 200000; }
  void restart() { sim::nota("ESP.restart() pedido por el sketch"); exit(0); }
};
extern SimEsp ESP;

unsigned long millis();
unsigned long micros();
void delay(unsigned long ms);
void delayMicroseconds(unsigned int us);
void yield();
void pinMode(uint8_t pin, uint8_t modo);
void digitalWrite(uint8_t pin, uint8_t v);
int digitalRead(uint8_t pin);
int analogRead(uint8_t pin);
void analogReadResolution(uint8_t bits);
void analogSetPinAttenuation(uint8_t pin, int at);
unsigned long pulseIn(uint8_t pin, uint8_t estado, unsigned long timeout_us = 1000000UL);
long map(long x, long in_min, long in_max, long out_min, long out_max);
long random(long max);
long random(long min, long max);
template <class T, class L, class H> T constrain(T x, L lo, H hi) { return x < lo ? lo : (x > hi ? hi : x); }

/* Como en Arduino: los clientes de red derivan de Client (PubSubClient lo usa). */
class Client {
 public:
  virtual ~Client() {}
};
class WiFiClient : public Client {};
