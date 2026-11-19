// c++ -std=c++17 -Wall -Wextra -I.. prueba_medidas.cpp && ./a.out
#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "medidas.h"

int main() {
  using namespace medidas;
  Medida m[] = {
      {"DHT22-T-LAB-AMB-01", "temperatura", "degC", 24.3f, nullptr, 1},
      {"BH1750-LAB-AMB-01", "luz", "lux", NAN, "sin respuesta", 1},
      {"HCSR04-LAB-AMB-01", "distancia", "cm", eco_a_cm(0), "sin eco", 1},
  };
  char out[1024];
  int n = mensaje_json("LAB-AMB-01", "esp32-ambiente-0.1.0", 1795701600123LL, "NTP", m, 3, out, sizeof out);
  printf("%s\n", out);
  assert(n == (int)strlen(out));
  assert(strstr(out, "\"timestamp_utc\":\"2026-11-26T14:00:00.123Z\""));
  assert(strstr(out, "\"value\":24.3}"));
  assert(strstr(out, "\"value\":null,\"error\":\"sin respuesta\""));
  assert(!strstr(out, "-999"));
  assert(mensaje_json("LAB-AMB-01", "x", 0, "NTP", m, 3, out, 50) == -1);  // no cabe
  assert(suelo_porcentaje(3000, 3000, 1300) == 0.0f);
  assert(suelo_porcentaje(1300, 3000, 1300) == 100.0f);
  assert(suelo_porcentaje(4095, 3000, 1300) == 0.0f);  // más seco que la calibración: se recorta
  assert(eco_a_cm(583) > 9.9f && eco_a_cm(583) < 10.1f);
  puts("BIEN");
}
