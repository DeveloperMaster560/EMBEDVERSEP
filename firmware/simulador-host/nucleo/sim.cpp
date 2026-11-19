/*
 * Implementación del simulador. Variables de entorno (las pone simular.py):
 *   SIM_ESCENARIO  CSV con columna t_s y una columna por magnitud
 *   SIM_DURACION_S tiempo virtual a simular
 *   SIM_INICIO_MS  hora UTC (ms) del arranque de la placa
 */
#include <map>
#include <set>
#include <sstream>
#include <vector>
#include <fstream>

#include "Arduino.h"
#include "BH1750.h"
#include "Wire.h"
#include "WiFi.h"
#include "esp_sntp.h"
#include "esp_timer.h"

SimSerial Serial;
SimEsp ESP;
SimWiFi WiFi;
TwoWire Wire;

void setup();
void loop();

namespace {
uint64_t g_us = 0;
int64_t g_inicio_ms = 0;
struct Fila { double t; std::vector<double> v; std::vector<bool> hay; };
std::vector<std::string> g_cols;
std::vector<Fila> g_filas;
std::set<std::string> g_avisadas;
sntp_sync_time_cb_t g_ntp_cb = nullptr;
int64_t g_ntp_en_us = -1;

void comprobar_ntp() {
  if (g_ntp_en_us >= 0 && (int64_t)g_us >= g_ntp_en_us) {
    g_ntp_en_us = -1;
    if (g_ntp_cb) { struct timeval tv; sim_gettimeofday(&tv, nullptr); g_ntp_cb(&tv); }
  }
}

void cargar_escenario(const char *ruta) {
  std::ifstream f(ruta);
  if (!f) { fprintf(stderr, "No se puede abrir el escenario %s\n", ruta); exit(2); }
  std::string linea;
  bool cabecera = true;
  while (std::getline(f, linea)) {
    if (!linea.empty() && linea.back() == '\r') linea.pop_back();
    if (linea.empty() || linea[0] == '#') continue;
    std::vector<std::string> celdas;
    std::stringstream ss(linea);
    std::string c;
    while (std::getline(ss, c, ',')) celdas.push_back(c);
    if (!linea.empty() && linea.back() == ',') celdas.push_back("");
    if (cabecera) {
      if (celdas.empty() || celdas[0] != "t_s") { fprintf(stderr, "La primera columna del escenario debe ser t_s\n"); exit(2); }
      g_cols.assign(celdas.begin() + 1, celdas.end());
      cabecera = false;
      continue;
    }
    Fila fila{atof(celdas[0].c_str()), {}, {}};
    for (size_t i = 0; i < g_cols.size(); ++i) {
      bool hay = i + 1 < celdas.size() && !celdas[i + 1].empty();
      fila.hay.push_back(hay);
      fila.v.push_back(hay ? atof(celdas[i + 1].c_str()) : 0);
    }
    if (!g_filas.empty() && fila.t <= g_filas.back().t) { fprintf(stderr, "t_s debe crecer en el escenario\n"); exit(2); }
    g_filas.push_back(fila);
  }
}
}  // namespace

namespace sim {
uint64_t us() { return g_us; }
void avanzar_us(uint64_t d) { g_us += d; comprobar_ntp(); }
int64_t utc_ms() { return g_inicio_ms + (int64_t)(g_us / 1000); }

bool valor(const std::string &col, double &v) {
  size_t k = 0;
  while (k < g_cols.size() && g_cols[k] != col) ++k;
  if (k == g_cols.size() || g_filas.empty()) return false;
  double t = g_us / 1e6;
  size_t i = 0;   /* última fila con t_s <= t */
  while (i + 1 < g_filas.size() && g_filas[i + 1].t <= t) ++i;
  const Fila &a = g_filas[i];
  if (t < a.t || !a.hay[k]) return false;            /* antes del escenario o celda vacía = falla */
  if (i + 1 < g_filas.size() && g_filas[i + 1].hay[k]) {   /* interpolación lineal */
    const Fila &b = g_filas[i + 1];
    v = a.v[k] + (b.v[k] - a.v[k]) * (t - a.t) / (b.t - a.t);
  } else {
    v = a.v[k];
  }
  return true;
}

bool hay_columna(const std::string &col) {
  for (auto &c : g_cols) if (c == col) return true;
  return false;
}

void publicar(const char *topico, const uint8_t *datos, unsigned n) {
  std::string p((const char *)datos, n);
  for (auto &ch : p) if (ch == '\n' || ch == '\r') ch = ' ';
  printf("\n@@PUB %llu %s %s\n", (unsigned long long)g_us, topico, p.c_str());
  fflush(stdout);
}

void nota(const char *texto) {
  if (g_avisadas.insert(texto).second) { printf("\n@@SIM %s\n", texto); fflush(stdout); }
}
}  // namespace sim

bool BH1750::hay_columna() { return sim::hay_columna("luz"); }

int sim_gettimeofday(struct timeval *tv, void *) {
  int64_t ms = sim::utc_ms();
  int64_t us = (int64_t)(g_us % 1000);
  tv->tv_sec = (time_t)(ms / 1000);
  tv->tv_usec = (decltype(tv->tv_usec))((ms % 1000) * 1000 + us);
  return 0;
}

unsigned long millis() { return (unsigned long)(g_us / 1000); }
unsigned long micros() { return (unsigned long)g_us; }
void delay(unsigned long ms) { sim::avanzar_us((uint64_t)ms * 1000); }
void delayMicroseconds(unsigned int us) { sim::avanzar_us(us); }
void yield() {}
void pinMode(uint8_t, uint8_t) {}
void digitalWrite(uint8_t, uint8_t) {}
int digitalRead(uint8_t pin) {
  double v;
  return sim::valor("D" + std::to_string(pin), v) && v != 0 ? HIGH : LOW;
}
static int g_bits_adc = 12;
int analogRead(uint8_t pin) {
  double v;
  std::string col = "A" + std::to_string(pin);
  if (!sim::valor(col, v)) {
    std::string n = "analogRead(" + std::to_string(pin) + "): el escenario no tiene columna " + col + " (o está vacía); devuelve 0";
    sim::nota(n.c_str());
    return 0;
  }
  long max = (1L << g_bits_adc) - 1;
  return (int)constrain(lround(v), 0L, max);
}
void analogReadResolution(uint8_t bits) { g_bits_adc = bits; }
void analogSetPinAttenuation(uint8_t, int) {}
unsigned long pulseIn(uint8_t, uint8_t, unsigned long timeout_us) {
  double cm;
  if (!sim::valor("distancia_cm", cm) || cm <= 0) { sim::avanzar_us(timeout_us); return 0; }
  unsigned long us = (unsigned long)(cm * 2.0 / 0.0343);   /* ida y vuelta a 343 m/s */
  if (us > timeout_us) { sim::avanzar_us(timeout_us); return 0; }
  sim::avanzar_us(us);
  return us;
}
long map(long x, long in_min, long in_max, long out_min, long out_max) {
  return (x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
}
long random(long max) { return max > 0 ? rand() % max : 0; }
long random(long min, long max) { return max > min ? min + rand() % (max - min) : min; }

void sntp_set_time_sync_notification_cb(sntp_sync_time_cb_t cb) { g_ntp_cb = cb; }
void configTime(long, int, const char *, const char *, const char *) { g_ntp_en_us = (int64_t)g_us + 2000000; }
int64_t esp_timer_get_time() { return (int64_t)g_us; }

int main() {
  const char *esc = getenv("SIM_ESCENARIO");
  const char *dur = getenv("SIM_DURACION_S");
  const char *ini = getenv("SIM_INICIO_MS");
  if (!esc || !dur || !ini) { fprintf(stderr, "Faltan SIM_ESCENARIO, SIM_DURACION_S o SIM_INICIO_MS\n"); return 2; }
  cargar_escenario(esc);
  g_inicio_ms = atoll(ini);
  uint64_t fin = (uint64_t)(atof(dur) * 1e6);
  srand(1);
  setup();
  while (g_us < fin) {
    uint64_t antes = g_us;
    loop();
    if (g_us == antes) sim::avanzar_us(1000);   /* loop() sin delay: 1 ms por vuelta */
  }
  printf("\n@@FIN %llu\n", (unsigned long long)g_us);
  return 0;
}
