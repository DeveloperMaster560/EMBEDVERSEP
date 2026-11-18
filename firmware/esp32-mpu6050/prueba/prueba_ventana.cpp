// c++ -std=c++17 -Wall -Wextra -I.. prueba_ventana.cpp -o /tmp/pv && /tmp/pv
// Imprime un registro de ejemplo (para validarlo con el contrato del servidor)
// y comprueba el CRC y las estadísticas.
#include "ventana.h"

#include <assert.h>

int main(int argc, char **) {
  static float d[1000 * 3];
  for (int i = 0; i < 1000; i++) {
    d[i * 3 + 0] = 0.1f * (float)((i % 2) ? 1 : -1);
    d[i * 3 + 1] = 0.0f;
    d[i * 3 + 2] = 9.81f;
  }
  d[500 * 3] = d[500 * 3 + 1] = d[500 * 3 + 2] = NAN;   // un hueco
  d[10 * 3 + 2] = 40.0f;                               // saturada (±4 g = 39,2 m/s²)
  shm::Resumen r{};
  r.secuencia = 7;
  r.inicio_utc_ms = 1795000000123LL;
  r.hora = shm::HORA_NTP;
  shm::resumir(d, 1000, 0.995f * 4 * 9.80665f, r);
  assert(r.huecos == 1 && r.saturadas == 1 && r.medidas == 999);
  assert(fabs(r.maximo[2] - 40.0) < 1e-6 && fabs(r.minimo[0] + 0.1) < 1e-6);
  // CRC de referencia: el de «123456789» es CBF43926.
  assert(shm::crc32_update(0, (const uint8_t *)"123456789", 9) == 0xCBF43926u);
  shm::Ajustes a{"LAB-ESP32-01", "MPU6050-LAB-ESP32-01", "esp32-mpu6050-0.1.0", "mpu6050-dlpf-21hz", 100.0f, 4.0f};
  char buf[1400];
  int n = shm::registro_json(a, r, buf, sizeof buf, "\"rssi_dbm\":-61");
  assert(n > 0);
  assert(shm::registro_json(a, r, buf, 100, nullptr) == -1);   // no cabe → -1, sin desbordar
  n = shm::registro_json(a, r, buf, sizeof buf, "\"rssi_dbm\":-61");
  if (argc > 1) printf("%s\n", buf); else printf("ventana: bien (%d bytes, crc %08lx)\n", n, (unsigned long)r.crc);
  return 0;
}
