/* BH1750 (ROHM), sensor de luz. Hoja de datos ROHM BH1750FVI.
   Escenario: columna «luz» (lux). Dirección 0x23 (ADDR a GND).
   Imita: comandos de modo, MTreg, tiempo de conversión (antes de terminar la
   primera, el registro de datos vale 0, como en el chip), saturación a 65535. */
#include <math.h>
#include "sim.h"
#include "sim_i2c.h"

class ChipBH1750 : public sim::ChipI2C {
 public:
  const char *nombre() const override { return "BH1750"; }
  bool presente() override { double v; return sim::valor("luz", v); }
  bool escribir(const uint8_t *d, size_t n) override {
    for (size_t i = 0; i < n; ++i) comando(d[i]);
    return true;
  }
  size_t leer(uint8_t *d, size_t n) override {
    actualizar();
    uint8_t b[2] = {(uint8_t)(dato_ >> 8), (uint8_t)dato_};
    for (size_t i = 0; i < n; ++i) d[i] = i < 2 ? b[i] : 0xFF;
    if (unico_ && listo()) modo_ = 0;            /* modo «una vez»: tras medir, se apaga */
    return n;
  }

 private:
  void comando(uint8_t c) {
    if (c == 0x00) { encendido_ = false; modo_ = 0; return; }
    if (c == 0x01) { encendido_ = true; return; }
    if (c == 0x07) { if (encendido_) dato_ = 0; return; }
    if ((c & 0xF8) == 0x40) { mtreg_ = (uint8_t)((mtreg_ & 0x1F) | ((c & 0x07) << 5)); return; }
    if ((c & 0xE0) == 0x60) { mtreg_ = (uint8_t)((mtreg_ & 0xE0) | (c & 0x1F)); return; }
    if (c == 0x10 || c == 0x11 || c == 0x13 || c == 0x20 || c == 0x21 || c == 0x23) {
      encendido_ = true;
      modo_ = c;
      unico_ = c >= 0x20;
      inicio_us_ = sim::us();
      return;
    }
  }
  /* Tiempo de conversión típico (hoja de datos): 120 ms alta resolución, 16 ms baja, ×MTreg/69. */
  bool listo() const {
    uint64_t base = (modo_ == 0x13 || modo_ == 0x23) ? 16000 : 120000;
    return sim::us() - inicio_us_ >= base * mtreg_ / 69;
  }
  void actualizar() {
    if (!modo_ || !listo()) return;
    double lux;
    if (!sim::valor("luz", lux)) return;
    /* cuentas = lux × 1,2 × MTreg/69 (×2 en «alta resolución 2») */
    double c = lux * 1.2 * mtreg_ / 69.0 * ((modo_ == 0x11 || modo_ == 0x21) ? 2 : 1);
    dato_ = (uint16_t)(c < 0 ? 0 : c > 65535 ? 65535 : lround(c));
  }
  bool encendido_ = false, unico_ = false;
  uint8_t modo_ = 0, mtreg_ = 69;
  uint16_t dato_ = 0;
  uint64_t inicio_us_ = 0;
};
SIM_CHIP_I2C(ChipBH1750, "BH1750", 0x23, "luz")
