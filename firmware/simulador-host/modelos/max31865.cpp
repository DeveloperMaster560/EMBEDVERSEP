/* MAX31865 (Maxim/Analog Devices): convertidor para RTD PT100/PT1000, por SPI.
   Hoja de datos MAX31865 rev. 4.

   Escenario:  #@ conectar MAX31865 cs=10 [r0=100] [rref=430] [columna=rtd]
     r0     resistencia del RTD a 0 °C (100 = PT100, 1000 = PT1000)
     rref   resistencia de referencia de la placa (430 en la de Adafruit para
            PT100, 4300 para PT1000)
     columna  temperatura del RTD en °C (por omisión «rtd»). Celda vacía =
            RTD abierto (cable suelto): el ADC lee a fondo de escala y se
            levanta el fallo «RTD High Threshold», como el chip real.

   Imita: registros 0x00-0x07 (escritura con el bit 7 de la dirección),
   autoincremento, SPI de la placa o por software (modo 1), VBIAS, conversión «una vez» (52 ms a 60 Hz, 62,5 ms a 50 Hz)
   y automática, umbrales y estado de fallos (se borran con el bit 1 de config).
   La resistencia sale de la ecuación de Callendar-Van Dusen (IEC 60751). */
#include <math.h>
#include <string>
#include "sim.h"
#include "sim_dispositivos.h"

class ChipMAX31865 : public sim::ChipSPI {
 public:
  explicit ChipMAX31865(const sim::Parametros &p)
      : ChipSPI(p, 1), r0_(p.real("r0", 100)), rref_(p.real("rref", 430)), col_(p.texto("columna", "rtd")) {
    reg_[3] = reg_[4] = 0xFF;   /* umbral alto por omisión: 0xFFFF */
    if (!sim::hay_columna(col_)) {
      sim::nota(("MAX31865: el escenario no tiene la columna «" + col_ + "»: el RTD está abierto todo el tiempo").c_str());
    }
  }
  const char *nombre() const override { return "MAX31865"; }
  void inicio_trama() override { primero_ = true; }
  uint8_t a_enviar() override {
    actualizar();
    return primero_ || escribe_ ? 0 : reg_[dir_ & 0x07];
  }
  void recibido(uint8_t b) override {
    actualizar();
    if (primero_) {
      primero_ = false;
      escribe_ = b & 0x80;
      dir_ = b & 0x7F;
      return;
    }
    if (escribe_) escribir(dir_ & 0x07, b);
    dir_ = (uint8_t)((dir_ + 1) & 0x07);
  }

 private:
  void escribir(uint8_t d, uint8_t v) {
    if (d == 0) {
      if (v & 0x02) reg_[7] = 0;   /* borrar fallos (se borra solo) */
      if ((v & 0x20) && (v & 0x80)) fin_us_ = sim::us() + (v & 0x01 ? 62500 : 52000);   /* una vez */
      if ((v & 0x40) && !(reg_[0] & 0x40)) siguiente_us_ = sim::us() + (v & 0x01 ? 62500 : 52000);
      reg_[0] = v & ~0x22;
    } else if (d >= 3 && d <= 6) {
      reg_[d] = v;                 /* umbrales; 1, 2 y 7 son de solo lectura */
    }
  }
  /* R(T) del RTD, IEC 60751. */
  double resistencia(double t) const {
    const double A = 3.9083e-3, B = -5.775e-7, C = -4.183e-12;
    double r = r0_ * (1 + A * t + B * t * t);
    if (t < 0) r += r0_ * C * (t - 100) * t * t * t;
    return r;
  }
  void convertir() {
    double t;
    uint16_t cuenta;
    bool abierto = !sim::valor(col_, t);
    if (abierto) {
      cuenta = 0x7FFF;
    } else {
      double c = resistencia(t) / rref_ * 32768.0;
      cuenta = (uint16_t)(c < 0 ? 0 : c > 32767 ? 32767 : lround(c));
    }
    uint16_t alto = (uint16_t)(((reg_[3] << 8) | reg_[4]) >> 1), bajo = (uint16_t)(((reg_[5] << 8) | reg_[6]) >> 1);
    if (abierto || cuenta >= alto) reg_[7] |= 0x80;
    if (cuenta <= bajo && !abierto) reg_[7] |= 0x40;
    uint16_t dato = (uint16_t)(cuenta << 1) | (reg_[7] ? 1 : 0);
    reg_[1] = (uint8_t)(dato >> 8);
    reg_[2] = (uint8_t)dato;
  }
  void actualizar() {
    uint64_t ahora = sim::us();
    if (fin_us_ && ahora >= fin_us_) { fin_us_ = 0; if (reg_[0] & 0x80) convertir(); }
    if ((reg_[0] & 0xC0) == 0xC0 && siguiente_us_ && ahora >= siguiente_us_) {
      convertir();
      siguiente_us_ = ahora + (reg_[0] & 0x01 ? 20000 : 16700);
    }
  }
  double r0_, rref_;
  std::string col_;
  uint8_t reg_[8] = {0};
  bool primero_ = false, escribe_ = false;
  uint8_t dir_ = 0;
  uint64_t fin_us_ = 0, siguiente_us_ = 0;
};
SIM_DISPOSITIVO(ChipMAX31865, "MAX31865")
