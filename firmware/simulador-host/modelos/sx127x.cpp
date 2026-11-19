/* SX1276/SX1277/SX1278 (Semtech) y RFM95/96 (HopeRF, el mismo chip): radio
   LoRa por SPI. Hoja de datos SX1276/77/78/79 rev. 7, modo LoRa.

   Escenario:  #@ conectar SX1276 cs=18 dio0=26 [rst=14] [rssi=-80] [snr=9]

   El «aire» es un archivo (simular_placa --aire): lo que transmite un nodo
   simulado queda allí con su hora, frecuencia, SF, ancho de banda y palabra
   de sincronía, y otro nodo simulado (el receptor) lo recibe más tarde si en
   ese instante estaba escuchando con la misma configuración. Así se prueba
   el par transmisor → receptor sin radios. Primero se simula el transmisor.

   Imita: registros con lectura de vuelta (RadioLib comprueba cada escritura),
   versión 0x12, FIFO de 256 bytes con su puntero, modos (dormir, espera, TX,
   RX continuo y único con su tiempo límite), tiempo en el aire con la fórmula
   de la hoja de datos, banderas de IRQ (se borran escribiendo 1), DIO0 según
   RegDioMapping1 (con su interrupción), RSSI y SNR del último paquete.
   No imita: FSK/OOK, CAD, saltos de frecuencia, colisiones entre paquetes,
   alcance (el paquete llega con el RSSI de la conexión o de la columna «rssi»). */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include "sim.h"
#include "sim_dispositivos.h"

namespace {
enum : uint8_t {
  FIFO = 0x00, OP_MODE = 0x01, FIFO_ADDR_PTR = 0x0D, FIFO_TX_BASE = 0x0E, FIFO_RX_BASE = 0x0F,
  FIFO_RX_CURRENT = 0x10, IRQ_FLAGS = 0x12, RX_NB_BYTES = 0x13, PKT_SNR = 0x19, PKT_RSSI = 0x1A, RSSI = 0x1B,
  HOP_CHANNEL = 0x1C, MODEM_CONFIG_1 = 0x1D, MODEM_CONFIG_2 = 0x1E, SYMB_TIMEOUT_LSB = 0x1F,
  PREAMBLE_MSB = 0x20, PREAMBLE_LSB = 0x21, PAYLOAD_LENGTH = 0x22, MODEM_CONFIG_3 = 0x26, SYNC_WORD = 0x39,
  DIO_MAPPING_1 = 0x40, VERSION = 0x42,
};
enum : uint8_t { DORMIR = 0, ESPERA = 1, TX = 3, RX_CONTINUO = 5, RX_UNICO = 6 };
enum : uint8_t { F_RX_TIMEOUT = 0x80, F_RX_DONE = 0x40, F_VALID_HEADER = 0x10, F_TX_DONE = 0x08 };
const double BW_KHZ[] = {7.8, 10.4, 15.6, 20.8, 31.25, 41.7, 62.5, 125, 250, 500};

struct Paquete {
  std::string origen;
  uint64_t t0, t1;          /* empieza (preámbulo) y termina, µs desde el arranque */
  uint32_t frf;
  int sf, bw, cr, sync, crc;
  std::vector<uint8_t> datos;
};
}  // namespace

class ChipSX127x : public sim::ChipSPI {
 public:
  explicit ChipSX127x(const sim::Parametros &p)
      : ChipSPI(p, 0), dio0_(p.pin("dio0")), rst_(p.pin("rst")),
        rssi_(p.real("rssi", -80)), snr_(p.real("snr", 9)), rssi_dado_(p.hay("rssi")) {
    reiniciar();
    const char *aire = getenv("SIM_AIRE");
    const char *yo = getenv("SIM_NOMBRE");
    yo_ = yo ? yo : "placa";
    if (aire) aire_ = aire;
    if (dio0_ < 0) sim::nota("SX127x: sin dio0=<pin> el programa no se entera de que terminó de transmitir o recibir");
    if (aire_.empty()) {
      sim::nota("SX127x: sin --aire lo transmitido no lo recibe nadie y no llega ningún paquete");
      return;
    }
    std::ifstream f(aire_);
    std::string l;
    int n = 0;
    while (std::getline(f, l)) {
      Paquete q;
      std::string hex;
      std::stringstream ss(l);
      if (!(ss >> q.origen >> q.t0 >> q.t1 >> q.frf >> q.sf >> q.bw >> q.cr >> q.sync >> q.crc >> hex)) continue;
      if (q.origen == yo_) continue;
      for (size_t i = 0; i + 1 < hex.size(); i += 2) q.datos.push_back((uint8_t)strtol(hex.substr(i, 2).c_str(), nullptr, 16));
      aire_paquetes_.push_back(q);
      size_t k = aire_paquetes_.size() - 1;
      sim::programar(q.t1, [this, k] { llega(aire_paquetes_[k]); });
      ++n;
    }
    char t[160];
    snprintf(t, sizeof t, "SX127x: en el aire hay %d paquetes de otros nodos simulados", n);
    sim::nota(t);
  }
  const char *nombre() const override { return "SX127x"; }

  void pin_escrito(int pin, int nivel) override {
    ChipSPI::pin_escrito(pin, nivel);
    if (pin == rst_ && nivel == 0) reiniciar();
  }
  int pin_leido(int pin) override { return pin == dio0_ ? dio0() : -1; }

  void inicio_trama() override { primero_ = true; }
  uint8_t a_enviar() override {
    if (primero_ || escribe_) return 0;
    return dir_ == FIFO ? fifo_[reg_[FIFO_ADDR_PTR]] : leer(dir_);
  }
  void recibido(uint8_t b) override {
    if (primero_) {
      primero_ = false;
      escribe_ = b & 0x80;
      dir_ = b & 0x7F;
      return;
    }
    if (dir_ == FIFO) {   /* la FIFO no avanza la dirección: avanza su puntero */
      if (escribe_) fifo_[reg_[FIFO_ADDR_PTR]] = b;
      reg_[FIFO_ADDR_PTR]++;
      return;
    }
    if (escribe_) escribir(dir_, b);
    dir_ = (uint8_t)((dir_ + 1) & 0x7F);
  }

 private:
  void reiniciar() {
    memset(reg_, 0, sizeof reg_);
    reg_[OP_MODE] = 0x09;
    reg_[0x06] = 0x6C; reg_[0x07] = 0x80; reg_[0x08] = 0x00;   /* 434 MHz */
    reg_[0x09] = 0x4F; reg_[0x0B] = 0x2B; reg_[0x0C] = 0x20;
    reg_[FIFO_TX_BASE] = 0x80;
    reg_[MODEM_CONFIG_1] = 0x72; reg_[MODEM_CONFIG_2] = 0x70; reg_[SYMB_TIMEOUT_LSB] = 0x64;
    reg_[PREAMBLE_LSB] = 0x08; reg_[PAYLOAD_LENGTH] = 0x01; reg_[0x24] = 0xFF;
    reg_[SYNC_WORD] = 0x12; reg_[VERSION] = 0x12;
    ++epoca_;
    actualizar_dio0();
  }
  uint8_t leer(uint8_t d) {
    if (d == RSSI) return (uint8_t)lround(-120 - desplazamiento_rssi());
    return reg_[d];
  }
  void escribir(uint8_t d, uint8_t v) {
    switch (d) {
      case IRQ_FLAGS: reg_[d] &= (uint8_t)~v; actualizar_dio0(); return;   /* 1 = borrar */
      case VERSION: case RX_NB_BYTES: case FIFO_RX_CURRENT: case PKT_SNR: case PKT_RSSI: case RSSI: case HOP_CHANNEL:
        return;                                                            /* solo lectura */
      case OP_MODE: cambiar_modo(v); return;
      case DIO_MAPPING_1: reg_[d] = v; actualizar_dio0(); return;
      default: reg_[d] = v;
    }
  }
  void cambiar_modo(uint8_t v) {
    uint8_t antes = reg_[OP_MODE] & 0x07;
    /* LongRangeMode (bit 7) solo cambia en modo dormir, como dice la hoja de datos. */
    if ((v & 0x80) != (reg_[OP_MODE] & 0x80) && antes != DORMIR) v = (uint8_t)((v & 0x7F) | (reg_[OP_MODE] & 0x80));
    reg_[OP_MODE] = v;
    uint8_t modo = v & 0x07;
    if (modo == antes) return;
    ++epoca_;
    if (!(v & 0x80)) return;                      /* FSK: no se imita */
    if (modo == TX) transmitir();
    if (modo == RX_CONTINUO || modo == RX_UNICO) {
      rx_desde_ = sim::us();
      if (modo == RX_UNICO) {
        uint64_t simbolos = ((reg_[MODEM_CONFIG_2] & 0x03) << 8) | reg_[SYMB_TIMEOUT_LSB];
        uint64_t limite = rx_desde_ + (uint64_t)(simbolos * simbolo_us());
        unsigned e = epoca_;
        sim::programar(limite, [this, e] { tiempo_limite_rx(e); });
      }
    }
  }
  /* --------------------------------------------------------- configuración */
  int sf() const { int s = reg_[MODEM_CONFIG_2] >> 4; return s < 6 ? 6 : s > 12 ? 12 : s; }
  int bw() const { return reg_[MODEM_CONFIG_1] >> 4; }
  int cr() const { return (reg_[MODEM_CONFIG_1] >> 1) & 0x07; }
  uint32_t frf() const { return ((uint32_t)reg_[0x06] << 16) | ((uint32_t)reg_[0x07] << 8) | reg_[0x08]; }
  double mhz() const { return frf() * 32.0 / 524288.0; }
  double desplazamiento_rssi() const { return mhz() < 525 ? -164 : -157; }
  double simbolo_us() const { return (double)(1 << sf()) / (BW_KHZ[bw() > 9 ? 9 : bw()] * 1000.0) * 1e6; }
  /* Tiempo en el aire, hoja de datos §4.1.1.7. */
  uint64_t tiempo_en_aire_us(size_t n) const {
    double ts = simbolo_us();
    int pre = (reg_[PREAMBLE_MSB] << 8) | reg_[PREAMBLE_LSB];
    int de = (reg_[MODEM_CONFIG_3] & 0x08) || ts > 16000 ? 1 : 0;
    int ih = reg_[MODEM_CONFIG_1] & 0x01, crc = (reg_[MODEM_CONFIG_2] >> 2) & 1;
    int c = cr() < 1 ? 1 : cr();
    double num = 8.0 * n - 4.0 * sf() + 28 + 16 * crc - 20 * ih;
    double simbolos = 8 + fmax(ceil(num / (4.0 * (sf() - 2 * de))) * (c + 4), 0);
    return (uint64_t)((pre + 4.25) * ts + simbolos * ts);
  }
  /* ----------------------------------------------------------- transmitir */
  void transmitir() {
    size_t n = reg_[PAYLOAD_LENGTH];
    Paquete q{yo_, sim::us(), sim::us() + tiempo_en_aire_us(n), frf(), sf(), bw(), cr(), reg_[SYNC_WORD],
              (reg_[MODEM_CONFIG_2] >> 2) & 1, {}};
    for (size_t i = 0; i < n; ++i) q.datos.push_back(fifo_[(uint8_t)(reg_[FIFO_TX_BASE] + i)]);
    unsigned e = epoca_;
    sim::programar(q.t1, [this, q, e] {
      if (e != epoca_) {
        sim::nota("SX127x: la transmisión se cortó antes de terminar (el programa cambió de modo)");
        return;
      }
      reg_[OP_MODE] = (uint8_t)((reg_[OP_MODE] & 0xF8) | ESPERA);
      ++epoca_;
      reg_[IRQ_FLAGS] |= F_TX_DONE;
      actualizar_dio0();
      if (aire_.empty()) return;
      FILE *f = fopen(aire_.c_str(), "a");
      if (!f) return;
      fprintf(f, "%s %llu %llu %u %d %d %d %d %d ", q.origen.c_str(), (unsigned long long)q.t0,
              (unsigned long long)q.t1, q.frf, q.sf, q.bw, q.cr, q.sync, q.crc);
      for (uint8_t b : q.datos) fprintf(f, "%02x", b);
      fprintf(f, "\n");
      fclose(f);
    });
  }
  /* ------------------------------------------------------------- recibir */
  bool escuchando() const {
    uint8_t m = reg_[OP_MODE] & 0x07;
    return (reg_[OP_MODE] & 0x80) && (m == RX_CONTINUO || m == RX_UNICO);
  }
  bool compatible(const Paquete &q, std::string &por_que) const {
    if (llabs((long long)q.frf - (long long)frf()) > 2000) { por_que = "otra frecuencia"; return false; }   /* ~120 kHz */
    if (q.sf != sf()) { por_que = "otro factor de dispersión (SF" + std::to_string(q.sf) + " frente a SF" + std::to_string(sf()) + ")"; return false; }
    if (q.bw != bw()) { por_que = "otro ancho de banda"; return false; }
    if (q.sync != reg_[SYNC_WORD]) { por_que = "otra palabra de sincronía"; return false; }
    return true;
  }
  void llega(const Paquete &q) {
    std::string por_que;
    if (!escuchando() || rx_desde_ > q.t0) {
      sim::nota("SX127x: llegó un paquete mientras la radio no escuchaba: se perdió (como en la placa)");
      return;
    }
    if (!compatible(q, por_que)) {
      sim::nota(("SX127x: hay un paquete en el aire pero con " + por_que + ": no se recibe").c_str());
      return;
    }
    double rssi = rssi_, snr = snr_, v;
    if (sim::valor("rssi", v)) rssi = v; else if (!rssi_dado_) sim::nota("SX127x: RSSI de los paquetes fijo en -80 dBm (columna «rssi» o rssi= en la conexión)");
    if (sim::valor("snr", v)) snr = v;
    uint8_t base = reg_[FIFO_RX_BASE];
    for (size_t i = 0; i < q.datos.size(); ++i) fifo_[(uint8_t)(base + i)] = q.datos[i];
    reg_[FIFO_RX_CURRENT] = base;
    reg_[RX_NB_BYTES] = (uint8_t)q.datos.size();
    reg_[HOP_CHANNEL] = (uint8_t)(q.crc ? 0x40 : 0);
    reg_[PKT_SNR] = (uint8_t)(int8_t)lround(snr * 4);
    reg_[PKT_RSSI] = (uint8_t)lround(fmax(0, fmin(255, rssi - desplazamiento_rssi() - (snr < 0 ? snr : 0))));
    reg_[IRQ_FLAGS] |= F_RX_DONE | F_VALID_HEADER;
    if ((reg_[OP_MODE] & 0x07) == RX_UNICO) { reg_[OP_MODE] = (uint8_t)((reg_[OP_MODE] & 0xF8) | ESPERA); ++epoca_; }
    actualizar_dio0();
  }
  void tiempo_limite_rx(unsigned e) {
    if (e != epoca_ || (reg_[OP_MODE] & 0x07) != RX_UNICO) return;
    for (auto &q : aire_paquetes_) {
      std::string x;
      if (q.t0 >= rx_desde_ && q.t0 <= sim::us() && compatible(q, x)) return;   /* ya detectó un preámbulo */
    }
    reg_[OP_MODE] = (uint8_t)((reg_[OP_MODE] & 0xF8) | ESPERA);
    ++epoca_;
    reg_[IRQ_FLAGS] |= F_RX_TIMEOUT;
    actualizar_dio0();
  }
  /* ------------------------------------------------------------------ DIO0 */
  int dio0() const {
    switch (reg_[DIO_MAPPING_1] >> 6) {
      case 0: return (reg_[IRQ_FLAGS] & F_RX_DONE) ? 1 : 0;
      case 1: return (reg_[IRQ_FLAGS] & F_TX_DONE) ? 1 : 0;
      case 2: return (reg_[IRQ_FLAGS] & 0x04) ? 1 : 0;   /* CadDone */
      default: return 0;
    }
  }
  void actualizar_dio0() {
    int n = dio0();
    if (n != nivel_dio0_) { nivel_dio0_ = n; if (dio0_ >= 0) sim::pin_cambio(dio0_, n); }
  }

  int dio0_, rst_;
  double rssi_, snr_;
  bool rssi_dado_;
  std::string aire_, yo_;
  std::vector<Paquete> aire_paquetes_;
  uint8_t reg_[128];
  uint8_t fifo_[256] = {0};
  bool primero_ = false, escribe_ = false;
  uint8_t dir_ = 0;
  unsigned epoca_ = 0;
  uint64_t rx_desde_ = 0;
  int nivel_dio0_ = 0;
};

class ChipSX1276 : public ChipSX127x { public: using ChipSX127x::ChipSX127x; };
class ChipSX1278 : public ChipSX127x { public: using ChipSX127x::ChipSX127x; };
class ChipRFM95 : public ChipSX127x { public: using ChipSX127x::ChipSX127x; };
SIM_DISPOSITIVO(ChipSX1276, "SX1276")
SIM_DISPOSITIVO(ChipSX1278, "SX1278")
SIM_DISPOSITIVO(ChipRFM95, "RFM95")
