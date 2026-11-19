/* Receptor GPS con salida NMEA 0183 (u-blox NEO-6M/M8N, Quectel L80, ATGM336H…).

   Escenario:  #@ conectar GPS serie=Serial2 [baudios=9600]   (o rx=<pin>)
     columnas latitud y longitud (grados decimales, sur y oeste negativos),
     altitud (m), y si se quieren velocidad_kmh, satelites, hdop.
     latitud o longitud vacía = sin posición (fix 0, campos vacíos), como un
     GPS bajo techo o en arranque en frío: para imitar el tiempo hasta la
     primera posición, deja vacías las primeras filas.

   Imita: una vez por segundo $GPRMC y $GPGGA con su suma de control, la hora
   UTC del instante simulado, a la velocidad del puerto (a 9600 baudios, los
   ~140 caracteres tardan ~145 ms en llegar). Ignora los comandos que le
   mande el programa (PMTK/UBX). Lo que no viene en el escenario (satélites,
   HDOP) va con un valor fijo que se avisa. */
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <string>
#include "sim.h"
#include "sim_dispositivos.h"

class ReceptorGPS : public sim::EquipoSerie {
 public:
  explicit ReceptorGPS(const sim::Parametros &p) : EquipoSerie(p) {
    if (!sim::hay_columna("latitud") || !sim::hay_columna("longitud"))
      sim::nota("GPS: el escenario no tiene latitud y longitud: nunca tendrá posición");
  }
  const char *nombre() const override { return "GPS"; }
  void del_programa(uint8_t, uint64_t) override {
    sim::nota("GPS: el programa le mandó comandos (PMTK/UBX); el modelo los ignora y sigue a 1 Hz con RMC y GGA");
  }
  void generar(uint64_t hasta, const std::function<void(uint64_t, uint8_t)> &poner) override {
    while (siguiente_s_ * 1000000ULL <= hasta) {
      uint64_t t = siguiente_s_ * 1000000ULL;
      std::string s = frases(t);
      for (size_t i = 0; i < s.size(); ++i) poner(t + (i + 1) * us_por_byte(), (uint8_t)s[i]);
      ++siguiente_s_;
    }
  }

 private:
  static std::string con_suma(const std::string &cuerpo) {
    uint8_t x = 0;
    for (char c : cuerpo) x ^= (uint8_t)c;
    char t[8];
    snprintf(t, sizeof t, "*%02X\r\n", x);
    return "$" + cuerpo + t;
  }
  static std::string grados(double v, bool lat) {
    double a = fabs(v);
    int g = (int)a;
    char t[24];
    snprintf(t, sizeof t, lat ? "%02d%08.5f,%c" : "%03d%08.5f,%c", g, (a - g) * 60.0,
             lat ? (v < 0 ? 'S' : 'N') : (v < 0 ? 'W' : 'E'));
    return t;
  }
  std::string frases(uint64_t t_us) {
    /* La hora del instante simulado (la que lee el valor del escenario). */
    int64_t ms = sim::utc_ms() - (int64_t)((sim::us() - t_us) / 1000);
    time_t s = (time_t)(ms / 1000);
    struct tm u;
    gmtime_r(&s, &u);
    char hora[16], fecha[8];
    snprintf(hora, sizeof hora, "%02d%02d%02d.00", u.tm_hour, u.tm_min, u.tm_sec);
    snprintf(fecha, sizeof fecha, "%02d%02d%02d", u.tm_mday, u.tm_mon + 1, u.tm_year % 100);
    double lat, lon, alt = 0, vel = 0, sats = 8, hdop = 0.9;
    bool fix = sim::valor("latitud", lat) && sim::valor("longitud", lon);
    sim::valor("altitud", alt);
    sim::valor("velocidad_kmh", vel);
    if (!sim::valor("satelites", sats) && fix) sim::nota("GPS: 8 satélites fijos (no hay columna «satelites»)");
    if (!sim::valor("hdop", hdop) && fix) sim::nota("GPS: HDOP 0,9 fijo (no hay columna «hdop»)");
    char b[160];
    std::string r;
    if (fix) {
      snprintf(b, sizeof b, "GPRMC,%s,A,%s,%s,%.2f,,%s,,,A", hora, grados(lat, true).c_str(),
               grados(lon, false).c_str(), vel / 1.852, fecha);
      r = con_suma(b);
      snprintf(b, sizeof b, "GPGGA,%s,%s,%s,1,%02d,%.1f,%.1f,M,0.0,M,,", hora, grados(lat, true).c_str(),
               grados(lon, false).c_str(), (int)sats, hdop, alt);
      r += con_suma(b);
    } else {
      snprintf(b, sizeof b, "GPRMC,%s,V,,,,,,,%s,,,N", hora, fecha);
      r = con_suma(b);
      snprintf(b, sizeof b, "GPGGA,%s,,,,,0,00,99.99,,,,,,", hora);
      r += con_suma(b);
    }
    return r;
  }
  uint64_t siguiente_s_ = 1;   /* la primera salida, al segundo de encender */
};
SIM_DISPOSITIVO(ReceptorGPS, "GPS")
