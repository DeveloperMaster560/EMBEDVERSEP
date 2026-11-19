/* Dispositivos que no se identifican solos: chips SPI (los elige un pin CS) y
   equipos en un puerto serie (GPS, medidores Modbus). En la placa real es el
   cableado el que dice dónde está cada uno; aquí lo dice el escenario:

     #@ conectar MAX31865 cs=10 rref=430 r0=100
     #@ conectar SX1276 cs=18 dio0=26 rst=14
     #@ conectar GPS serie=Serial2 baudios=9600
     #@ conectar PZEM004T rx=4                  (SoftwareSerial con RX en el pin 4)

   (o --conectar "MAX31865 cs=10" en simular_placa). Los pines van en número o
   en nombre STM32 (PA4, PB0…). Los modelos se escriben desde la hoja de datos
   y responden con lo que diga el escenario; si su columna está vacía, el
   dispositivo calla o informa falla, como el real desconectado. */
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <functional>
#include <map>
#include <string>

namespace sim {
class Parametros {
 public:
  std::map<std::string, std::string> m;
  bool hay(const std::string &k) const { return m.count(k) > 0; }
  std::string texto(const std::string &k, const std::string &def = "") const;
  double real(const std::string &k, double def) const;
  long entero(const std::string &k, long def) const;
  /* Pin: número o nombre STM32 (PA4 = 4, PB0 = 16, PC13 = 45). -1 si falta. */
  int pin(const std::string &k) const;
};

/* Lo que todo dispositivo puede hacer con los pines. */
class Dispositivo {
 public:
  virtual ~Dispositivo() {}
  virtual const char *nombre() const = 0;
  /* El programa escribió un pin (CS, RST…). */
  virtual void pin_escrito(int pin, int nivel) { (void)pin; (void)nivel; }
  /* ¿Maneja este pin? Nivel 0/1, o -1 si no es suyo. */
  virtual int pin_leido(int pin) { (void)pin; return -1; }
};

/* SPI: el bus entrega cada byte al chip con su CS en LOW. Sirve el SPI de la
   placa (SPI.transfer) y el SPI «por software», con pines movidos a mano
   (sck=, mosi=, miso= en la conexión; modo= 0-3, el del chip por omisión). */
class ChipSPI : public Dispositivo {
 public:
  ChipSPI(const Parametros &p, int modo_del_chip)
      : cs_(p.pin("cs")), sck_(p.pin("sck")), mosi_(p.pin("mosi")), miso_(p.pin("miso")),
        modo_((int)p.entero("modo", modo_del_chip)) {}
  int cs() const { return cs_; }
  bool seleccionado() const { return sel_; }
  void pin_escrito(int pin, int nivel) override {
    if (pin == cs_) {
      bool s = nivel == 0;
      if (s && !sel_) { sel_ = true; bit_ = 0; entra_ = 0; inicio_trama(); }
      else if (!s && sel_) { sel_ = false; fin_trama(); }
    } else if (pin == mosi_) {
      nivel_mosi_ = nivel != 0;
    } else if (pin == sck_ && (nivel != 0) != nivel_sck_) {
      nivel_sck_ = nivel != 0;
      /* Flanco de muestreo: subida en modos 0 y 3, bajada en 1 y 2. */
      bool muestrea = (modo_ == 0 || modo_ == 3) ? nivel_sck_ : !nivel_sck_;
      if (!sel_ || !muestrea) return;
      if (bit_ == 0) sale_ = a_enviar();
      nivel_miso_ = (sale_ >> (7 - bit_)) & 1;
      entra_ = (uint8_t)((entra_ << 1) | (nivel_mosi_ ? 1 : 0));
      if (++bit_ == 8) { recibido(entra_); bit_ = 0; entra_ = 0; }
    }
  }
  int pin_leido(int pin) override { return pin == miso_ && sel_ ? nivel_miso_ : -1; }
  uint8_t intercambiar(uint8_t mosi) { uint8_t r = a_enviar(); recibido(mosi); return r; }
  virtual void inicio_trama() {}
  virtual void fin_trama() {}
  /* Lo que el chip saca por MISO en el próximo byte (no depende de lo que entra). */
  virtual uint8_t a_enviar() = 0;
  /* El byte que entró por MOSI. */
  virtual void recibido(uint8_t mosi) = 0;
 protected:
  int cs_, sck_, mosi_, miso_, modo_;
  bool sel_ = false, nivel_sck_ = false, nivel_mosi_ = false;
  int nivel_miso_ = 0, bit_ = 0;
  uint8_t entra_ = 0, sale_ = 0;
};

/* Puerto serie: el equipo recibe lo que escribe el programa y entrega bytes
   con la hora a la que llegan (a su velocidad). */
class EquipoSerie : public Dispositivo {
 public:
  explicit EquipoSerie(const Parametros &p) : baudios_(p.entero("baudios", 9600)) {}
  long baudios() const { return baudios_; }
  /* µs que tarda un carácter (8N1 = 10 bits). */
  uint64_t us_por_byte() const { return (uint64_t)(10000000.0 / baudios_); }
  /* Byte del programa, que termina de salir en t_us. */
  virtual void del_programa(uint8_t b, uint64_t t_us) { (void)b; (void)t_us; }
  /* Entrega (con poner) los bytes que manda el equipo hasta t_us, en orden. */
  virtual void generar(uint64_t hasta_us, const std::function<void(uint64_t, uint8_t)> &poner) = 0;
 protected:
  long baudios_;
};

/* Registro de modelos: SIM_DISPOSITIVO(Clase, "NOMBRE") en modelos/. */
typedef Dispositivo *(*FabricaDispositivo)(const Parametros &);
struct ModeloDispositivo {
  const char *nombre;
  FabricaDispositivo crear;
  ModeloDispositivo *siguiente;
};
void registrar_dispositivo(ModeloDispositivo *m);

/* Tiempo: f() se ejecuta cuando el reloj virtual llega a t_us. */
void programar(uint64_t t_us, std::function<void()> f);
/* Un dispositivo cambió el nivel de un pin suyo: dispara la interrupción si la hay. */
void pin_cambio(int pin, int nivel);

/* Para el núcleo (SPI.h, HardwareSerial, SoftwareSerial). */
uint8_t spi_intercambiar(uint8_t mosi);
EquipoSerie *equipo_en(const std::string &puerto);   /* "Serial1", "rx4"… */
}  // namespace sim

#define SIM_DISPOSITIVO(clase, nombre)                                                          \
  static sim::Dispositivo *crear_##clase(const sim::Parametros &p) { return new clase(p); }    \
  static sim::ModeloDispositivo modelo_##clase = {nombre, crear_##clase, nullptr};              \
  static struct registro_##clase {                                                              \
    registro_##clase() { sim::registrar_dispositivo(&modelo_##clase); }                         \
  } registro_inst_##clase;
