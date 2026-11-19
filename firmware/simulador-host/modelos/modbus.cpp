/* Equipos Modbus RTU en un puerto serie (RS-485 o TTL). Especificación
   «MODBUS over Serial Line V1.02» y «MODBUS Application Protocol V1.1b3».

   Genérico (cualquier caudalímetro, medidor o variador):
     #@ conectar MODBUS serie=Serial2 dir=1 baudios=9600 r0=caudal*10 r1=temperatura*100
       rN=columna*escala   el registro N (función 3 o 4) vale round(columna × escala),
                           entero de 16 bits con signo, como lo hacen la mayoría
     Un registro no declarado responde la excepción 02 (dirección ilegal); una
     columna vacía, la excepción 04 (falla del equipo).

   PZEM-004T v3.0 (Peacefair), medidor de energía AC:
     #@ conectar PZEM004T serie=Serial2      (o rx=<pin> con SoftwareSerial)
       columnas tension (V), corriente (A), potencia (W), energia (kWh),
       frecuencia (Hz), factor_potencia. El PZEM se alimenta del lado de AC:
       con «tension» vacía no responde, como el real sin red.
       Registros de entrada 0-9 con la escala de su manual (0,1 V; 0,001 A en
       32 bits; 0,1 W; 1 Wh; 0,1 Hz; 0,01), dirección propia o la general 0xF8.

   Imita: trama RTU con CRC-16 (una trama con CRC malo se ignora, como hace el
   esclavo), silencio de 3,5 caracteres entre tramas, retardo de respuesta,
   difusión (dirección 0: no responde), funciones 03, 04 y 06. */
#include <math.h>
#include <stdio.h>
#include <map>
#include <string>
#include <vector>
#include "sim.h"
#include "sim_dispositivos.h"

namespace {
uint16_t crc16(const uint8_t *d, size_t n) {
  uint16_t c = 0xFFFF;
  for (size_t i = 0; i < n; ++i) {
    c ^= d[i];
    for (int b = 0; b < 8; ++b) c = (c & 1) ? (uint16_t)((c >> 1) ^ 0xA001) : (uint16_t)(c >> 1);
  }
  return c;
}
}  // namespace

class EsclavoModbus : public sim::EquipoSerie {
 public:
  explicit EsclavoModbus(const sim::Parametros &p, long dir_por_omision)
      : EquipoSerie(p), dir_((uint8_t)p.entero("dir", dir_por_omision)), respuesta_us_((uint64_t)(p.real("respuesta_ms", 5) * 1000)) {}

  void del_programa(uint8_t b, uint64_t t) override {
    /* Un silencio de más de 3,5 caracteres separa tramas. */
    if (!trama_.empty() && t - ultimo_us_ > us_por_byte() * 7 / 2 + us_por_byte()) trama_.clear();
    ultimo_us_ = t;
    trama_.push_back(b);
    size_t largo = largo_de_trama();
    if (largo && trama_.size() >= largo) {
      std::vector<uint8_t> t2(trama_.begin(), trama_.begin() + largo);
      trama_.clear();
      atender(t2, t);
    }
  }
  void generar(uint64_t hasta, const std::function<void(uint64_t, uint8_t)> &poner) override {
    while (!salida_.empty() && salida_.front().first <= hasta) {
      poner(salida_.front().first, salida_.front().second);
      salida_.erase(salida_.begin());
    }
  }

 protected:
  /* Registro de 16 bits: false = excepción (codigo 02 o 04). */
  virtual bool registro(uint8_t funcion, uint16_t r, uint16_t &v, uint8_t &codigo) = 0;
  virtual bool escribir_registro(uint16_t r, uint16_t v) { (void)r; (void)v; return false; }
  virtual bool encendido() { return true; }
  virtual bool es_mia(uint8_t d) const { return d == dir_; }
  virtual size_t largo_de_trama() const {
    if (trama_.size() < 2) return 0;
    uint8_t f = trama_[1];
    if (f == 3 || f == 4 || f == 6) return 8;
    if (f == 0x42) return 4;   /* PZEM: borrar energía */
    return trama_.size() >= 8 ? 8 : 0;
  }
  virtual void funcion_propia(const std::vector<uint8_t> &t, std::vector<uint8_t> &r) {
    r = {t[0], (uint8_t)(t[1] | 0x80), 0x01};   /* función ilegal */
  }

 private:
  void atender(const std::vector<uint8_t> &t, uint64_t fin) {
    uint16_t c = crc16(t.data(), t.size() - 2);
    if (t[t.size() - 2] != (uint8_t)c || t[t.size() - 1] != (uint8_t)(c >> 8)) {
      sim::nota((std::string(nombre()) + ": llegó una trama con CRC incorrecto: el equipo no responde").c_str());
      return;
    }
    if (!es_mia(t[0])) return;                  /* otra dirección o difusión (0): silencio */
    if (!encendido()) {
      sim::nota((std::string(nombre()) + ": sin alimentación en este tramo del escenario: no responde").c_str());
      return;
    }
    std::vector<uint8_t> r;
    uint8_t f = t[1];
    if (f == 3 || f == 4) {
      uint16_t inicio = (uint16_t)((t[2] << 8) | t[3]), n = (uint16_t)((t[4] << 8) | t[5]);
      if (n < 1 || n > 125) {
        r = {t[0], (uint8_t)(f | 0x80), 0x03};
      } else {
        r = {t[0], f, (uint8_t)(n * 2)};
        for (uint16_t i = 0; i < n; ++i) {
          uint16_t v = 0;
          uint8_t codigo = 0x02;
          if (!registro(f, (uint16_t)(inicio + i), v, codigo)) { r = {t[0], (uint8_t)(f | 0x80), codigo}; break; }
          r.push_back((uint8_t)(v >> 8));
          r.push_back((uint8_t)v);
        }
      }
    } else if (f == 6) {
      uint16_t reg = (uint16_t)((t[2] << 8) | t[3]), v = (uint16_t)((t[4] << 8) | t[5]);
      if (escribir_registro(reg, v)) r.assign(t.begin(), t.end() - 2);
      else r = {t[0], (uint8_t)(f | 0x80), 0x02};
    } else {
      funcion_propia(t, r);
    }
    uint16_t c2 = crc16(r.data(), r.size());
    r.push_back((uint8_t)c2);
    r.push_back((uint8_t)(c2 >> 8));
    uint64_t t0 = fin + us_por_byte() * 7 / 2 + respuesta_us_;
    for (size_t i = 0; i < r.size(); ++i) salida_.emplace_back(t0 + (i + 1) * us_por_byte(), r[i]);
  }

 protected:
  uint8_t dir_;
 private:
  uint64_t respuesta_us_, ultimo_us_ = 0;
  std::vector<uint8_t> trama_;
  std::vector<std::pair<uint64_t, uint8_t>> salida_;
};

/* ------------------------------------------------------------- genérico */
class EquipoModbus : public EsclavoModbus {
 public:
  explicit EquipoModbus(const sim::Parametros &p) : EsclavoModbus(p, 1) {
    for (auto &kv : p.m) {
      if (kv.first.size() < 2 || kv.first[0] != 'r' || !isdigit((unsigned char)kv.first[1])) continue;
      std::string col = kv.second;
      double escala = 1;
      size_t x = col.find('*');
      if (x != std::string::npos) { escala = atof(col.c_str() + x + 1); col = col.substr(0, x); }
      mapa_[(uint16_t)atoi(kv.first.c_str() + 1)] = {col, escala};
    }
    if (mapa_.empty()) sim::nota("MODBUS: sin registros (r0=columna*escala…): todo responde «dirección ilegal»");
  }
  const char *nombre() const override { return "MODBUS"; }
 protected:
  bool registro(uint8_t, uint16_t r, uint16_t &v, uint8_t &codigo) override {
    auto i = mapa_.find(r);
    if (i == mapa_.end()) { codigo = 0x02; return false; }
    double x;
    if (!sim::valor(i->second.first, x)) { codigo = 0x04; return false; }
    long n = lround(x * i->second.second);
    v = (uint16_t)(int16_t)(n < -32768 ? -32768 : n > 32767 ? 32767 : n);
    return true;
  }
 private:
  std::map<uint16_t, std::pair<std::string, double>> mapa_;
};
SIM_DISPOSITIVO(EquipoModbus, "MODBUS")

/* ------------------------------------------------------------ PZEM-004T */
class MedidorPZEM : public EsclavoModbus {
 public:
  explicit MedidorPZEM(const sim::Parametros &p) : EsclavoModbus(p, 0x01) {}
  const char *nombre() const override { return "PZEM-004T"; }
 protected:
  bool es_mia(uint8_t d) const override { return d == dir_ || d == 0xF8; }
  bool encendido() override { double v; return sim::valor("tension", v); }
  bool registro(uint8_t f, uint16_t r, uint16_t &v, uint8_t &codigo) override {
    codigo = 0x02;
    if (f == 3) {                               /* registros de configuración */
      if (r == 1) { v = umbral_; return true; }
      if (r == 2) { v = dir_; return true; }
      return false;
    }
    auto leer = [](const char *col, double escala) { double x; return sim::valor(col, x) ? fmax(0, x * escala) : 0.0; };
    uint32_t corriente = (uint32_t)lround(leer("corriente", 1000)), potencia = (uint32_t)lround(leer("potencia", 10)),
             energia = (uint32_t)lround(leer("energia", 1000));
    switch (r) {
      case 0: v = (uint16_t)lround(leer("tension", 10)); return true;
      case 1: v = (uint16_t)corriente; return true;
      case 2: v = (uint16_t)(corriente >> 16); return true;
      case 3: v = (uint16_t)potencia; return true;
      case 4: v = (uint16_t)(potencia >> 16); return true;
      case 5: v = (uint16_t)energia; return true;
      case 6: v = (uint16_t)(energia >> 16); return true;
      case 7: v = (uint16_t)lround(leer("frecuencia", 10)); return true;
      case 8: v = (uint16_t)lround(leer("factor_potencia", 100)); return true;
      case 9: v = (uint16_t)(leer("potencia", 1) > umbral_ ? 0xFFFF : 0); return true;
      default: return false;
    }
  }
  bool escribir_registro(uint16_t r, uint16_t v) override {
    if (r == 1) { umbral_ = v; return true; }
    if (r == 2 && v >= 1 && v <= 0xF7) { dir_ = (uint8_t)v; return true; }
    return false;
  }
  void funcion_propia(const std::vector<uint8_t> &t, std::vector<uint8_t> &r) override {
    if (t[1] == 0x42) {
      sim::nota("PZEM-004T: el programa borró el contador de energía (el escenario manda: «energia» sigue su columna)");
      r = {t[0], 0x42};
      return;
    }
    EsclavoModbus::funcion_propia(t, r);
  }
 private:
  uint16_t umbral_ = 23000;
};
SIM_DISPOSITIVO(MedidorPZEM, "PZEM004T")
