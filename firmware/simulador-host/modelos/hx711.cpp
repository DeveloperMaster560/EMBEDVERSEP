/* HX711 (Avia Semiconductor): ADC de 24 bits para celdas de carga, con su
   propio protocolo de dos hilos (DOUT y PD_SCK). Hoja de datos HX711.

   Escenario:  #@ conectar HX711 dout=2 sck=3 [columna=hx711] [escala=1] [cero=0]
     La columna da la lectura: cuentas = cero + valor × escala. Por omisión
     la columna «hx711» son cuentas crudas; con columna=carga_kg escala=2280
     cero=84000 se escribe la carga en kg y el modelo la pasa a cuentas como
     lo haría esa celda. Celda vacía = celda desconectada: DOUT queda en alto
     y el programa espera (is_ready() falso), como con el cable suelto.

   Imita: DOUT en bajo cuando hay dato (10 muestras/s), un bit por pulso de
   reloj (el más significativo primero, en complemento a dos, saturado a
   ±2^23), y 25, 26 o 27 pulsos para elegir la siguiente ganancia/canal. */
#include <math.h>
#include <string>
#include "sim.h"
#include "sim_dispositivos.h"

class ChipHX711 : public sim::Dispositivo {
 public:
  explicit ChipHX711(const sim::Parametros &p)
      : dout_(p.pin("dout")), sck_(p.pin("sck")), col_(p.texto("columna", "hx711")),
        escala_(p.real("escala", 1)), cero_(p.real("cero", 0)) {
    if (dout_ < 0 || sck_ < 0) sim::nota("HX711: faltan dout=<pin> y sck=<pin>");
    if (!sim::hay_columna(col_)) sim::nota(("HX711: el escenario no tiene la columna «" + col_ + "»: celda desconectada").c_str());
  }
  const char *nombre() const override { return "HX711"; }
  int pin_leido(int pin) override {
    if (pin != dout_) return -1;
    nueva_conversion();
    if (pulsos_ == 0) {
      if (listo()) { esperando_desde_ = 0; return 0; }
      double v;
      if (!sim::valor(col_, v)) {
        if (!esperando_desde_) esperando_desde_ = sim::us();
        else if (sim::us() - esperando_desde_ > 1000000)
          sim::nota("HX711: celda desconectada y el programa lleva más de 1 s esperando a que DOUT baje "
                    "(read()/get_units() esperan para siempre; usar wait_ready_timeout())");
      }
      return 1;
    }
    if (pulsos_ <= 24) return (dato_ >> (24 - pulsos_)) & 1;
    return 1;                                   /* tras el pulso 25, DOUT sube hasta el próximo dato */
  }
  void pin_escrito(int pin, int nivel) override {
    if (pin != sck_) return;
    bool alto = nivel != 0, sube = alto && !reloj_;
    reloj_ = alto;
    if (!sube) return;
    nueva_conversion();
    if (pulsos_ == 0) {
      if (!listo()) return;                     /* sin dato, el pulso no hace nada */
      dato_ = lectura();
    }
    if (++pulsos_ == 25) proximo_us_ = sim::us() + 100000;   /* 10 muestras/s; 26-27 = ganancia */
  }

 private:
  void nueva_conversion() { if (pulsos_ >= 25 && sim::us() >= proximo_us_) pulsos_ = 0; }
  bool listo() {
    double v;
    return sim::us() >= proximo_us_ && sim::valor(col_, v);
  }
  uint32_t lectura() {
    double v = 0;
    sim::valor(col_, v);
    double c = cero_ + v * escala_;
    long n = lround(c < -8388608 ? -8388608 : c > 8388607 ? 8388607 : c);
    return (uint32_t)n & 0xFFFFFF;
  }
  int dout_, sck_;
  std::string col_;
  double escala_, cero_;
  bool reloj_ = false;
  int pulsos_ = 0;
  uint32_t dato_ = 0;
  uint64_t proximo_us_ = 0, esperando_desde_ = 0;
};
SIM_DISPOSITIVO(ChipHX711, "HX711")
