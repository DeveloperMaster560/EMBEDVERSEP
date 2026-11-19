/* SCD40/SCD41 (Sensirion), CO2 + temperatura + humedad. Hoja de datos
   Sensirion SCD4x v1.6. Escenario: co2 (ppm), temperatura (°C), humedad (%HR).
   Dirección 0x62.
   Imita: comandos de 16 bits con CRC-8 (polinomio 0x31, inicio 0xFF) en cada
   palabra, medición periódica (un dato nuevo cada 5 s; leer sin dato nuevo =
   NACK), medición única (5 s), get_data_ready_status, número de serie, y
   los ajustes que se escriben y se leen (offset de temperatura, altitud,
   presión, autocalibración). No imita: autocalibración real, tiempos de
   ejecución de cada comando, consumo. */
#include <math.h>
#include <map>
#include "sim.h"
#include "sim_i2c.h"

static uint8_t crc8(const uint8_t *d, size_t n) {
  uint8_t c = 0xFF;
  for (size_t i = 0; i < n; ++i) {
    c ^= d[i];
    for (int b = 0; b < 8; ++b) c = (c & 0x80) ? (uint8_t)((c << 1) ^ 0x31) : (uint8_t)(c << 1);
  }
  return c;
}

class ChipSCD4x : public sim::ChipI2C {
 public:
  ChipSCD4x() {
    ajustes_[0x2318] = (uint16_t)lround(4.0 * 65535 / 175);   /* offset de temperatura de fábrica: 4 °C */
    ajustes_[0x2313] = 1;                                       /* autocalibración activada */
    ajustes_[0x233f] = 400;
    ajustes_[0x2340] = 44;
    ajustes_[0x234b] = 156;
    ajustes_[0xe000] = 1013;                                    /* presión ambiente en hPa */
  }
  const char *nombre() const override { return "SCD41"; }
  bool presente() override { double v; return sim::valor("co2", v); }

  bool escribir(const uint8_t *d, size_t n) override {
    nresp_ = 0;
    if (n < 2) return true;
    uint16_t cmd = (uint16_t)(d[0] << 8 | d[1]);
    uint16_t arg = 0;
    if (n >= 5) {
      if (crc8(d + 2, 2) != d[4]) return false;   /* CRC mal: el chip no lo acepta */
      arg = (uint16_t)(d[2] << 8 | d[3]);
    }
    static const std::map<uint16_t, uint16_t> SET_GET = {
        {0x241d, 0x2318}, {0x2427, 0x2322}, {0x2416, 0x2313}, {0x243a, 0x233f}, {0x2445, 0x2340}, {0x244e, 0x234b}};
    auto sg = SET_GET.find(cmd);
    if (sg != SET_GET.end() && n >= 5) { ajustes_[sg->second] = arg; return true; }
    if (cmd == 0xe000 && n >= 5) { ajustes_[0xe000] = arg; return true; }
    switch (cmd) {
      case 0x21b1: case 0x21ac: periodico_ = true; inicio_us_ = sim::us(); ultimo_ = 0; return true;   /* periódica / bajo consumo (30 s) */
      case 0x3f86: periodico_ = false; return true;
      case 0x219d: case 0x2196: unica_us_ = sim::us(); periodico_ = false; return true;
      case 0x36e0: case 0x36f6: case 0x3646: case 0x3615: case 0x3632: return true;
      case 0xe4b8: responder({(uint16_t)(listo() ? 0x8006 : 0x8000)}); return true;
      case 0x3682: responder({0x5349, 0x4D55, 0x4C41}); return true;   /* serie ficticio: «SIMULA» */
      case 0xec05: {
        if (!listo()) return true;   /* sin dato nuevo: la lectura que sigue recibe NACK */
        consumir();
        double co2, t, h;
        sim::valor("co2", co2);
        bool ht = sim::valor("temperatura", t), hh = sim::valor("humedad", h);
        if (!ht || !hh) sim::nota("SCD41: falta temperatura o humedad en el escenario; ese canal lee 0 en crudo");
        responder({(uint16_t)lround(co2 < 0 ? 0 : co2 > 65535 ? 65535 : co2),
                   (uint16_t)(ht ? lround(fmin(fmax((t + 45) * 65535 / 175, 0), 65535)) : 0),
                   (uint16_t)(hh ? lround(fmin(fmax(h * 65535 / 100, 0), 65535)) : 0)});
        return true;
      }
      default: {
        auto g = ajustes_.find(cmd);
        if (g != ajustes_.end()) responder({g->second});
        return true;
      }
    }
  }
  size_t leer(uint8_t *d, size_t n) override {
    if (!nresp_) return 0;   /* nada que leer: NACK */
    size_t m = n < nresp_ ? n : nresp_;
    for (size_t i = 0; i < m; ++i) d[i] = resp_[i];
    nresp_ = 0;
    return m;
  }

 private:
  /* Un dato nuevo por periodo (5 s; 30 s en bajo consumo, que aquí se trata igual), o a los 5 s de la medición única. */
  uint64_t periodo_actual() const { return periodico_ ? (sim::us() - inicio_us_) / 5000000ULL : 0; }
  bool listo() const {
    if (periodico_) return periodo_actual() > ultimo_;
    return unica_us_ && sim::us() - unica_us_ >= 5000000ULL;
  }
  void consumir() { if (periodico_) ultimo_ = periodo_actual(); else unica_us_ = 0; }
  void responder(std::initializer_list<uint16_t> palabras) {
    nresp_ = 0;
    for (uint16_t w : palabras) {
      resp_[nresp_] = (uint8_t)(w >> 8);
      resp_[nresp_ + 1] = (uint8_t)w;
      resp_[nresp_ + 2] = crc8(resp_ + nresp_, 2);
      nresp_ += 3;
    }
  }
  bool periodico_ = false;
  uint64_t inicio_us_ = 0, unica_us_ = 0, ultimo_ = 0;
  std::map<uint16_t, uint16_t> ajustes_;
  uint8_t resp_[18];
  size_t nresp_ = 0;
};
SIM_CHIP_I2C(ChipSCD4x, "SCD41", 0x62, "co2")
