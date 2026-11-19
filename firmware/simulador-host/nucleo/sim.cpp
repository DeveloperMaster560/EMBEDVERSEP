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
#include <functional>

#include "Arduino.h"
#include "Wire.h"
#include "esp_sntp.h"
#include "esp_timer.h"
#include "sim_i2c.h"
#include "sim_dispositivos.h"

HardwareSerial Serial(0);
HardwareSerial Serial1(1);
HardwareSerial Serial2(2);
HardwareSerial Serial3(3);
TwoWire Wire(0);
#include "SPI.h"
SPIClass SPI(0);
volatile uint32_t sim_registro_puerto = 0;
TwoWire Wire1(1);
#if defined(ARDUINO_ARCH_ESP32) || defined(ARDUINO_ARCH_ESP8266)
SimEsp ESP;
#endif
#ifdef SIM_WIFI
#include "WiFi.h"
SimWiFi WiFi;
#endif

namespace {
uint64_t g_us = 0;
int64_t g_inicio_ms = 0;
struct Fila { double t; std::vector<double> v; std::vector<bool> hay; };
std::vector<std::string> g_cols;
std::vector<Fila> g_filas;
std::set<std::string> g_avisadas;
sntp_sync_time_cb_t g_ntp_cb = nullptr;
int64_t g_ntp_en_us = -1;
uint64_t g_fin_us = 0;
std::vector<std::string> g_conexiones;          /* «#@ conectar …» del escenario y --conectar */
std::multimap<uint64_t, std::function<void()>> g_eventos;
bool g_en_eventos = false;
bool g_dispositivos_listos = false;
sim::ModeloDispositivo *g_modelos_disp = nullptr;
std::vector<sim::Dispositivo *> g_disp;
std::map<std::string, sim::EquipoSerie *> g_puertos;
struct Interrupcion { void (*f)(void); int modo; int nivel; };
std::map<int, Interrupcion> g_isr;

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
    if (linea.rfind("#@", 0) == 0) { g_conexiones.push_back(linea.substr(2)); continue; }
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
bool linea_nueva = true;
uint64_t us() { return g_us; }
void avanzar_us(uint64_t d) {
  uint64_t destino = g_us + d;
  /* Lo que pasa entre medias (una radio que termina de transmitir, un dato que
     llega) ocurre a su hora: el reloj se para en cada evento. */
  while (!g_en_eventos && !g_eventos.empty() && g_eventos.begin()->first <= destino) {
    auto e = g_eventos.begin();
    std::function<void()> f = std::move(e->second);
    if (e->first > g_us) g_us = e->first;
    g_eventos.erase(e);
    g_en_eventos = true;
    f();
    g_en_eventos = false;
    if (g_us > destino) destino = g_us;
  }
  g_us = destino;
  comprobar_ntp();
  /* El fin llega aunque el sketch esté parado en setup() (p. ej. while (true) delay(1000);). */
  if (g_fin_us && g_us >= g_fin_us) { printf("\n@@FIN %llu\n", (unsigned long long)g_us); fflush(stdout); exit(0); }
}
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
  linea_nueva = true;
  printf("\n@@PUB %llu %s %s\n", (unsigned long long)g_us, topico, p.c_str());
  fflush(stdout);
}

void nota(const char *texto) {
  if (g_avisadas.insert(texto).second) { linea_nueva = true; printf("\n@@SIM %s\n", texto); fflush(stdout); }
}
}  // namespace sim

/* ---------------------------------------------------------------- I2C */
namespace {
sim::ModeloI2C *g_modelos = nullptr;
sim::ChipI2C *g_bus[128] = {nullptr};
}  // namespace

namespace sim {
void registrar_modelo(ModeloI2C *m) { m->siguiente = g_modelos; g_modelos = m; }
ChipI2C *chip_en(uint8_t d) { return d < 128 ? g_bus[d] : nullptr; }
void conectar_chips() {
  for (ModeloI2C *m = g_modelos; m; m = m->siguiente) {
    if (!hay_columna(m->columna)) continue;
    if (g_bus[m->direccion]) {
      std::string n = std::string("I2C: ") + m->nombre + " y " + g_bus[m->direccion]->nombre() + " en la misma dirección";
      nota(n.c_str());
      continue;
    }
    g_bus[m->direccion] = m->crear();
    char t[96];
    snprintf(t, sizeof t, "I2C: %s conectado en 0x%02X (columna «%s»)", m->nombre, m->direccion, m->columna);
    nota(t);
  }
}
}  // namespace sim

/* ------------------------------------------------- avr-libc que falta en el PC */
static char *a_texto(unsigned long long v, bool negativo, char *s, int base) {
  char t[66];
  int i = 0;
  if (base < 2 || base > 36) { s[0] = 0; return s; }
  do { int d = (int)(v % base); t[i++] = (char)(d < 10 ? '0' + d : 'a' + d - 10); v /= base; } while (v);
  int j = 0;
  if (negativo) s[j++] = '-';
  while (i) s[j++] = t[--i];
  s[j] = 0;
  return s;
}
extern "C" {
char *itoa(int v, char *s, int b) { return b == 10 && v < 0 ? a_texto((unsigned long long)(-(long long)v), true, s, b) : a_texto((unsigned)v, false, s, b); }
char *ltoa(long v, char *s, int b) { return b == 10 && v < 0 ? a_texto((unsigned long long)(-(long long)v), true, s, b) : a_texto((unsigned long)v, false, s, b); }
char *utoa(unsigned v, char *s, int b) { return a_texto(v, false, s, b); }
char *ultoa(unsigned long v, char *s, int b) { return a_texto(v, false, s, b); }
char *dtostrf(double v, signed char ancho, unsigned char dec, char *s) { sprintf(s, "%*.*f", ancho, dec, v); return s; }
}

int sim_gettimeofday(struct timeval *tv, void *) {
  int64_t ms = sim::utc_ms();
  int64_t us = (int64_t)(g_us % 1000);
  tv->tv_sec = (time_t)(ms / 1000);
  tv->tv_usec = (decltype(tv->tv_usec))((ms % 1000) * 1000 + us);
  return 0;
}

static void pin_a_dispositivos(uint8_t pin, uint8_t v);
static int pin_de_dispositivo(uint8_t pin);
namespace sim { void conectar_dispositivos(const char *env); }

/* Consultar la hora, ceder o leer un pin cuesta tiempo en la placa: 1 µs aquí.
   Así terminan los bucles que esperan a un pin o a un tiempo límite (RadioLib,
   esperas activas), que en el PC darían vueltas para siempre. */
unsigned long millis() { sim::avanzar_us(1); return (unsigned long)(g_us / 1000); }
unsigned long micros() { sim::avanzar_us(1); return (unsigned long)g_us; }
void delay(unsigned long ms) { sim::avanzar_us((uint64_t)ms * 1000); }
void delayMicroseconds(unsigned int us) { sim::avanzar_us(us); }
void yield() { sim::avanzar_us(1); }
void pinMode(uint8_t, uint8_t) {}
void digitalWrite(uint8_t pin, uint8_t v) { pin_a_dispositivos(pin, v); }
int digitalRead(uint8_t pin) {
  sim::avanzar_us(1);
  /* Se llama millones de veces en las esperas activas: nada de texto por llamada. */
  static std::string col[256];
  static signed char hay[256] = {0};   /* 0 sin mirar · 1 hay columna · -1 no hay */
  int n = pin_de_dispositivo(pin);
  if (n >= 0) return n;
  if (!hay[pin]) {
    col[pin] = "D" + std::to_string(pin);
    hay[pin] = sim::hay_columna(col[pin]) ? 1 : -1;
    if (hay[pin] < 0) {
      std::string n = "digitalRead(" + std::to_string(pin) + "): el escenario no tiene columna " + col[pin] + "; lee LOW";
      sim::nota(n.c_str());
    }
  }
  double v;
  return hay[pin] > 0 && sim::valor(col[pin], v) && v != 0 ? HIGH : LOW;
}
static int g_bits_adc = SIM_BITS_ADC;
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
void analogSetAttenuation(int) {}
void analogWrite(uint8_t, int) {}
unsigned long pulseInLong(uint8_t p, uint8_t e, unsigned long t) { return pulseIn(p, e, t); }
void attachInterrupt(uint8_t pin, void (*f)(void), int modo) {
  int n = pin_de_dispositivo(pin);
  if (n < 0) {
    std::string t = "attachInterrupt(" + std::to_string(pin) + "): ningún dispositivo conectado maneja ese pin; no habrá interrupciones";
    sim::nota(t.c_str());
  }
  g_isr[pin] = {f, modo, n < 0 ? 0 : n};
}
void detachInterrupt(uint8_t pin) { g_isr.erase(pin); }
void tone(uint8_t, unsigned int, unsigned long) {}
void noTone(uint8_t) {}
/* Como el núcleo de Arduino: un pulso de reloj por bit (los dispositivos conectados los ven). */
void shiftOut(uint8_t datos, uint8_t reloj, uint8_t orden, uint8_t v) {
  for (uint8_t i = 0; i < 8; i++) {
    digitalWrite(datos, orden == LSBFIRST ? (v >> i) & 1 : (v >> (7 - i)) & 1);
    digitalWrite(reloj, HIGH);
    digitalWrite(reloj, LOW);
  }
}
uint8_t shiftIn(uint8_t datos, uint8_t reloj, uint8_t orden) {
  uint8_t v = 0;
  for (uint8_t i = 0; i < 8; ++i) {
    digitalWrite(reloj, HIGH);
    if (orden == LSBFIRST) v |= digitalRead(datos) << i;
    else v |= digitalRead(datos) << (7 - i);
    digitalWrite(reloj, LOW);
  }
  return v;
}
void randomSeed(unsigned long s) { srand((unsigned)s); }
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
  sim::conectar_chips();
  sim::conectar_dispositivos(getenv("SIM_CONEXIONES"));
  g_inicio_ms = atoll(ini);
  uint64_t fin = (uint64_t)(atof(dur) * 1e6);
  g_fin_us = fin;
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

/* ------------------------------------------- dispositivos (SPI, serie, pines) */

namespace sim {
std::string Parametros::texto(const std::string &k, const std::string &def) const {
  auto i = m.find(k);
  return i == m.end() ? def : i->second;
}
double Parametros::real(const std::string &k, double def) const { return hay(k) ? atof(m.at(k).c_str()) : def; }
long Parametros::entero(const std::string &k, long def) const { return hay(k) ? strtol(m.at(k).c_str(), nullptr, 0) : def; }
int Parametros::pin(const std::string &k) const {
  if (!hay(k)) return -1;
  const std::string &v = m.at(k);
  if (v.size() >= 3 && v[0] == 'P' && v[1] >= 'A' && v[1] <= 'C') return (v[1] - 'A') * 16 + atoi(v.c_str() + 2);
  if (!v.empty() && (v[0] == 'D' || v[0] == 'G')) return atoi(v.c_str() + (v[0] == 'G' ? 4 : 1));   /* D10, GPIO26 */
  return atoi(v.c_str());
}

void registrar_dispositivo(ModeloDispositivo *m) { m->siguiente = g_modelos_disp; g_modelos_disp = m; }

void programar(uint64_t t_us, std::function<void()> f) { g_eventos.emplace(t_us, std::move(f)); }

void pin_cambio(int pin, int nivel) {
  auto i = g_isr.find(pin);
  if (i == g_isr.end()) return;
  int antes = i->second.nivel;
  i->second.nivel = nivel;
  bool dispara = (i->second.modo == RISING && !antes && nivel) || (i->second.modo == FALLING && antes && !nivel) ||
                 (i->second.modo == CHANGE && antes != nivel);
  if (dispara && i->second.f) i->second.f();
}

uint8_t spi_intercambiar(uint8_t mosi) {
  avanzar_us(1);   /* un byte a ~8 MHz: así terminan las esperas que solo leen registros */
  int r = -1;
  for (auto *d : g_disp) {
    auto *c = dynamic_cast<ChipSPI *>(d);
    if (c && c->seleccionado()) r = c->intercambiar(mosi) & (r < 0 ? 0xFF : r);   /* MISO compartido */
  }
  if (r < 0) {
    nota("SPI: transferencia sin ningún chip seleccionado (falta «#@ conectar <chip> cs=<pin>» en el escenario, "
         "o el CS no coincide): MISO lee 0");
    return 0;
  }
  return (uint8_t)r;
}

EquipoSerie *equipo_en(const std::string &puerto) {
  auto i = g_puertos.find(puerto);
  return i == g_puertos.end() ? nullptr : i->second;
}

/* «MAX31865 cs=10 rref=430» → dispositivo conectado. */
void conectar_dispositivos(const char *env) {
  std::vector<std::string> lineas = g_conexiones;
  if (env) {
    std::string t(env), l;
    std::stringstream ss(t);
    while (std::getline(ss, l, '\n')) lineas.push_back(l);
  }
  for (auto &l : lineas) {
    std::stringstream ss(l);
    std::string palabra, modelo;
    ss >> palabra;
    if (palabra != "conectar") { nota(("escenario: «#@" + l + "» no se entiende (se espera «#@ conectar MODELO clave=valor…»)").c_str()); continue; }
    ss >> modelo;
    Parametros p;
    while (ss >> palabra) {
      size_t eq = palabra.find('=');
      if (eq != std::string::npos) p.m[palabra.substr(0, eq)] = palabra.substr(eq + 1);
    }
    ModeloDispositivo *m = g_modelos_disp;
    while (m && modelo != m->nombre) m = m->siguiente;
    if (!m) {
      std::string disp;
      for (ModeloDispositivo *x = g_modelos_disp; x; x = x->siguiente) disp += std::string(disp.empty() ? "" : ", ") + x->nombre;
      nota(("conectar " + modelo + ": el simulador no tiene ese modelo (hay: " + disp + ")").c_str());
      continue;
    }
    Dispositivo *d = m->crear(p);
    g_disp.push_back(d);
    std::string donde;
    if (auto *c = dynamic_cast<ChipSPI *>(d)) {
      if (c->cs() < 0) { nota((modelo + ": falta cs=<pin> (el pin de selección del chip)").c_str()); continue; }
      donde = "SPI, CS en el pin " + std::to_string(c->cs());
    } else if (auto *e = dynamic_cast<EquipoSerie *>(d)) {
      std::string puerto = p.hay("serie") ? p.texto("serie") : p.hay("rx") ? "rx" + std::to_string(p.pin("rx")) : "";
      if (puerto.empty()) { nota((modelo + ": falta serie=Serial1|Serial2 o rx=<pin> (SoftwareSerial)").c_str()); continue; }
      g_puertos[puerto] = e;
      donde = (puerto[0] == 'r' ? "SoftwareSerial con RX en el pin " + puerto.substr(2) : puerto) + " a " +
              std::to_string(e->baudios()) + " baudios";
    }
    if (donde.empty()) {
      for (auto &kv : p.m) donde += (donde.empty() ? "" : ", ") + kv.first + "=" + kv.second;
    }
    nota((modelo + " conectado (" + donde + ")").c_str());
  }
  g_dispositivos_listos = true;
}

/* ------------------------------------------------------------ puerto serie */
/* Los objetos globales del sketch abren el puerto antes de que el escenario
   conecte nada (p. ej. PZEM004Tv30 pzem(Serial2) llama a begin en su
   constructor): el equipo se busca cada vez hasta encontrarlo. */
EquipoSerie *PuertoSerie::equipo() {
  if (!eq_ && g_dispositivos_listos) {
    eq_ = equipo_en(nombre_);
    if (eq_ && baudios_ && (long)baudios_ != eq_->baudios()) {
      nota((nombre_ + ": el programa usa " + std::to_string(baudios_) + " baudios y " + eq_->nombre() + " " +
            std::to_string(eq_->baudios()) + ": llegará basura, como en la placa").c_str());
    }
    if (!eq_ && baudios_ && !avisado_vacio_) {
      avisado_vacio_ = true;
      nota((nombre_ + ": no hay nada conectado a ese puerto (#@ conectar <equipo> " +
            (nombre_[0] == 'r' ? "rx=" + nombre_.substr(2) : "serie=" + nombre_) + ")").c_str());
    }
  }
  return eq_;
}
void PuertoSerie::begin(unsigned long b) {
  baudios_ = b;
  eq_ = nullptr;   /* vuelve a comprobar la velocidad */
  equipo();
}
void PuertoSerie::llenar() {
  if (!equipo()) return;
  uint64_t ahora = us();
  bool basura = baudios_ && (long)baudios_ != eq_->baudios();
  eq_->generar(ahora, [&](uint64_t t, uint8_t b) { en_camino_.emplace_back(t, basura ? (uint8_t)(b ^ 0xA5) | 0x80 : b); });
  while (!en_camino_.empty() && en_camino_.front().first <= ahora) {
    if (!baudios_) { /* el puerto no está abierto: lo que llega se pierde */ }
    else if (bufer_.size() < SIM_BUFER_SERIE) bufer_.push_back(en_camino_.front().second);
    else if (++perdidos_ == 1) {
      nota((nombre_ + ": se perdieron bytes porque el programa no lee a tiempo (búfer de " +
            std::to_string(SIM_BUFER_SERIE) + " bytes lleno)").c_str());
    }
    en_camino_.pop_front();
  }
}
int PuertoSerie::available() { avanzar_us(1); llenar(); return (int)bufer_.size(); }
int PuertoSerie::read() {
  llenar();
  if (bufer_.empty()) return -1;
  int c = bufer_.front();
  bufer_.pop_front();
  return c;
}
int PuertoSerie::peek() { llenar(); return bufer_.empty() ? -1 : bufer_.front(); }
size_t PuertoSerie::write(uint8_t c) {
  uint64_t por_byte = baudios_ ? (uint64_t)(10000000.0 / baudios_) : 0;
  salida_us_ = std::max(salida_us_, us()) + por_byte;
  if (equipo() && baudios_) eq_->del_programa((long)baudios_ == eq_->baudios() ? c : (uint8_t)(c ^ 0xA5), salida_us_);
  return 1;
}
void PuertoSerie::flush() { if (salida_us_ > us()) avanzar_us(salida_us_ - us()); }
}  // namespace sim

/* Pines que maneja un dispositivo (CS, RST de entrada; DIO0 de salida). */
static void pin_a_dispositivos(uint8_t pin, uint8_t v) { for (auto *d : g_disp) d->pin_escrito(pin, v); }
static int pin_de_dispositivo(uint8_t pin) {
  for (auto *d : g_disp) { int n = d->pin_leido(pin); if (n >= 0) return n; }
  return -1;
}
