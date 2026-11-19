/*
 * Núcleo del simulador en el PC: reloj virtual y escenario de sensores.
 * El sketch NO se modifica: se compila contra estas cabeceras en lugar de las
 * del ESP32/Arduino. Lo que no está simulado no compila (mejor que inventar).
 */
#pragma once
#include <stdint.h>
#include <string>

namespace sim {
/* Reloj virtual en microsegundos desde el arranque de la placa. */
uint64_t us();
void avanzar_us(uint64_t d);
/* Hora UTC (ms) del instante virtual actual. */
int64_t utc_ms();
/* Valor del escenario para una columna en el instante actual. false = celda
   vacía (el sensor falla en ese momento) o columna inexistente. */
bool valor(const std::string &columna, double &v);
bool hay_columna(const std::string &columna);
/* Publicación MQTT: va a la salida estándar con un prefijo que lee el lanzador. */
void publicar(const char *topico, const uint8_t *datos, unsigned n);
void nota(const char *texto);
}  // namespace sim
