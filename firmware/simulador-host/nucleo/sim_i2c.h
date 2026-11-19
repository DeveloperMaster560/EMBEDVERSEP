/* Bus I2C simulado. Wire entrega cada transacción al modelo del chip que
   responde en esa dirección (modelos/). Si no hay ninguno, o el escenario
   dice que el sensor falla en ese instante, el bus responde NACK: lo mismo que
   ve el programa con el sensor desconectado. */
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace sim {
class ChipI2C {
 public:
  virtual ~ChipI2C() {}
  virtual const char *nombre() const = 0;
  /* ¿Responde ahora? (la columna principal del escenario tiene valor). */
  virtual bool presente() = 0;
  /* Escritura del maestro (sin la dirección). false = NACK. */
  virtual bool escribir(const uint8_t *datos, size_t n) = 0;
  /* Lectura del maestro: llena hasta n bytes; devuelve cuántos (0 = NACK). */
  virtual size_t leer(uint8_t *datos, size_t n) = 0;
};

/* Registro de modelos: cada modelo se declara con SIM_CHIP_I2C (ver modelos/). */
typedef ChipI2C *(*FabricaChip)();
struct ModeloI2C {
  const char *nombre;
  uint8_t direccion;
  const char *columna;      /* si el escenario la tiene, el chip está conectado */
  FabricaChip crear;
  ModeloI2C *siguiente;
};
void registrar_modelo(ModeloI2C *m);
ChipI2C *chip_en(uint8_t direccion);
/* Conecta los chips cuyas columnas tiene el escenario. */
void conectar_chips();
}  // namespace sim

#define SIM_CHIP_I2C(clase, nombre, dir, columna)                                       \
  static sim::ChipI2C *crear_##clase() { return new clase(); }                          \
  static sim::ModeloI2C modelo_##clase = {nombre, dir, columna, crear_##clase, nullptr}; \
  static struct registro_##clase { registro_##clase() { sim::registrar_modelo(&modelo_##clase); } } registro_inst_##clase;
