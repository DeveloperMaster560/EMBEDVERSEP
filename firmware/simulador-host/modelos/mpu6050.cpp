/* MPU-6050 (InvenSense/TDK), acelerómetro y giróscopo. Mapa de registros
   RM-MPU-6000A-00 rev. 4.2. Escenario: acel_x, acel_y, acel_z (m/s²; la
   gravedad incluida: en reposo y plano, acel_z ≈ 9.81), giro_x, giro_y,
   giro_z (°/s) y temperatura (°C). Dirección 0x68 (AD0 a GND).
   Imita: WHO_AM_I, reinicio por PWR_MGMT_1 (bit 7 se borra solo), reposo
   tras encender (bit SLEEP: los datos no se actualizan), rangos de
   ACCEL_CONFIG / GYRO_CONFIG, saturación a ±32767, autoincremento.
   No imita: FIFO, interrupciones, filtro digital, ruido. */
#include <math.h>
#include <string.h>
#include <string>
#include "sim.h"
#include "sim_i2c.h"

class ChipMPU6050 : public sim::ChipI2C {
 public:
  ChipMPU6050() { reiniciar(); }
  const char *nombre() const override { return "MPU6050"; }
  bool presente() override { double v; return sim::valor("acel_z", v); }
  bool escribir(const uint8_t *d, size_t n) override {
    if (!n) return true;
    ptr_ = d[0] & 0x7F;
    for (size_t i = 1; i < n; ++i) { poner(ptr_, d[i]); ptr_ = (ptr_ + 1) & 0x7F; }
    return true;
  }
  size_t leer(uint8_t *d, size_t n) override {
    if (ptr_ <= 0x48 && ptr_ + n > 0x3B) muestrear();
    for (size_t i = 0; i < n; ++i) { d[i] = r_[ptr_]; ptr_ = (ptr_ + 1) & 0x7F; }
    return n;
  }

 private:
  void reiniciar() {
    memset(r_, 0, sizeof r_);
    r_[0x6B] = 0x40;   /* PWR_MGMT_1: en reposo al arrancar */
    r_[0x75] = 0x68;   /* WHO_AM_I */
  }
  void poner(uint8_t reg, uint8_t v) {
    if (reg == 0x75) return;                                  /* solo lectura */
    if (reg == 0x6B && (v & 0x80)) { reiniciar(); return; }   /* DEVICE_RESET: vuelve a valores de fábrica */
    if (reg == 0x68) { r_[reg] = 0; return; }                 /* SIGNAL_PATH_RESET se borra solo */
    if (reg >= 0x3B && reg <= 0x48) return;                   /* datos: solo lectura */
    r_[reg] = v;
  }
  static int16_t a_crudo(double v) { long c = lround(v); return (int16_t)(c > 32767 ? 32767 : c < -32768 ? -32768 : c); }
  double columna(const char *c) {
    double v;
    if (sim::valor(c, v)) return v;
    std::string t = std::string("MPU6050: sin valor en la columna «") + c + "»; ese canal lee 0 en crudo";
    sim::nota(t.c_str());
    return NAN;
  }
  void muestrear() {
    if (r_[0x6B] & 0x40) return;   /* SLEEP: los registros de datos no cambian */
    static const double lsb_g[] = {16384, 8192, 4096, 2048};
    static const double lsb_gs[] = {131, 65.5, 32.8, 16.4};
    double ag = lsb_g[(r_[0x1C] >> 3) & 3], gg = lsb_gs[(r_[0x1B] >> 3) & 3];
    const char *ac[] = {"acel_x", "acel_y", "acel_z"}, *gc[] = {"giro_x", "giro_y", "giro_z"};
    int16_t v[7];
    for (int i = 0; i < 3; ++i) { double a = columna(ac[i]); v[i] = isnan(a) ? 0 : a_crudo(a / 9.80665 * ag); }
    double t = columna("temperatura");
    v[3] = isnan(t) ? 0 : a_crudo((t - 36.53) * 340.0);
    for (int i = 0; i < 3; ++i) { double g = columna(gc[i]); v[4 + i] = isnan(g) ? 0 : a_crudo(g * gg); }
    for (int i = 0; i < 7; ++i) { r_[0x3B + 2 * i] = (uint8_t)((uint16_t)v[i] >> 8); r_[0x3C + 2 * i] = (uint8_t)v[i]; }
  }
  uint8_t r_[128];
  uint8_t ptr_ = 0;
};
SIM_CHIP_I2C(ChipMPU6050, "MPU6050", 0x68, "acel_z")
