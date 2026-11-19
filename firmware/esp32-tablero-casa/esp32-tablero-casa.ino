/*
 * Tablero eléctrico de una casa (ESP32): medidor PZEM-004T v3.0 en la
 * acometida + DHT22 dentro del tablero, enviando al contrato de MEDIDAS de la
 * plataforma (shm/v1/<ID>/medida). Un solo archivo para poder pegarlo en el
 * editor de la app; lo secreto (Wi-Fi, clave MQTT) va en secretos.h.
 *
 * Qué mide (y nada más):
 *   tensión (V), corriente (A), potencia (W), energía acumulada (kWh),
 *   frecuencia (Hz) y factor de potencia de toda la casa; temperatura dentro
 *   del tablero (°C).
 * Qué NO hace: no corta circuitos ni da alarmas. La protección de la casa la
 *   hacen los interruptores automáticos y el diferencial; los umbrales de
 *   aviso los firma el ingeniero en el proyecto y los aplica la plataforma.
 *
 * Lo aprendido al simular con la biblioteca real (PZEM004Tv30 1.2.1):
 *   - en los primeros 200 ms devuelve ceros sin preguntar → se espera 1 s;
 *   - tras una lectura fallida, voltage() da NaN pero current(), energy()…
 *     devuelven los valores VIEJOS → si la tensión es NaN, todo va a null.
 *   - el PZEM se alimenta del lado de AC: sin red no responde (null, no 0).
 *
 * Conexión: PZEM TX → GPIO16 (RX2), PZEM RX → GPIO17 (TX2), 5 V y GND.
 *           DHT22 datos → GPIO4 (resistencia de 10 kΩ a 3,3 V).
 * Bibliotecas oficiales: «PZEM004Tv30», «DHT sensor library», «PubSubClient».
 */
#include <DHT.h>
#include <PZEM004Tv30.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <esp_sntp.h>
#include <esp_timer.h>
#include <sys/time.h>

#define ESTACION_ID   "CASA-TAB-01"           /* = id en proyectos/<proyecto>/proyecto.json */
#define FIRMWARE_VER  "esp32-tablero-casa-0.1.0"
#define DHT_PIN       4
#define PZEM_RX       16
#define PZEM_TX       17
#define INTERVALO_MS  10000
#define MENSAJE_POR_SERIE 1

#if __has_include("secretos.h")
#include "secretos.h"
#else
/* Sin secretos.h compila y se puede simular, pero no se conecta a ninguna red. */
#define WIFI_SSID     ""
#define WIFI_CLAVE    ""
#define MQTT_SERVIDOR "127.0.0.1"
#define MQTT_PUERTO   1884
#define MQTT_CLAVE    ""
#endif

struct Medida {
  const char *sensor_id, *magnitud, *unidad;
  float valor;         /* NAN = no hubo lectura */
  const char *error;
  uint8_t decimales;
};

static const int MSG_MAX = 1200;
static DHT s_dht(DHT_PIN, DHT22);
static PZEM004Tv30 s_pzem(Serial2, PZEM_RX, PZEM_TX);
static WiFiClient s_red;
static PubSubClient s_mqtt(s_red);
static volatile int64_t s_ultima_sincro_us = 0;
static char s_topico[48];
static char s_pendiente[MSG_MAX];
static int s_pendiente_n = 0;

static void sincronizado(struct timeval *) { s_ultima_sincro_us = esp_timer_get_time(); }

static int mensaje_json(int64_t utc_ms, const char *calidad, const Medida *m, int n, char *out, size_t cap) {
  size_t k = 0;
  bool ok = true;
  auto pon = [&](const char *fmt, auto... args) {
    if (!ok) return;
    int r = snprintf(out + k, cap - k, fmt, args...);
    if (r < 0 || (size_t)r >= cap - k) ok = false; else k += (size_t)r;
  };
  time_t s = (time_t)(utc_ms / 1000);
  struct tm t;
  gmtime_r(&s, &t);
  char hora[25];
  snprintf(hora, sizeof hora, "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", t.tm_year + 1900, t.tm_mon + 1, t.tm_mday,
           t.tm_hour, t.tm_min, t.tm_sec, (int)(utc_ms % 1000));
  pon("{\"schema_version\":\"1.0\",\"station_id\":\"%s\",\"timestamp_utc\":\"%s\",\"time_quality\":\"%s\","
      "\"firmware_version\":\"%s\",\"measurements\":[", ESTACION_ID, hora, calidad, FIRMWARE_VER);
  for (int i = 0; i < n; ++i) {
    pon("%s{\"sensor_id\":\"%s\",\"quantity\":\"%s\",\"unit\":\"%s\",\"value\":", i ? "," : "", m[i].sensor_id, m[i].magnitud, m[i].unidad);
    if (isfinite(m[i].valor)) pon("%.*f}", (int)m[i].decimales, (double)m[i].valor);
    else if (m[i].error) pon("null,\"error\":\"%s\"}", m[i].error);
    else pon("%s", "null}");
  }
  pon("%s", "]}");
  return ok ? (int)k : -1;
}

static void medir() {
  if (s_ultima_sincro_us == 0) {            /* sin hora no se inventa el instante */
    Serial.println("# esperando hora NTP; no se envía nada");
    return;
  }
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  int64_t t = (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
  const char *calidad = esp_timer_get_time() - s_ultima_sincro_us > 2LL * 3600 * 1000000 ? "HOLDOVER" : "NTP";

  float v = s_pzem.voltage();
  bool red = !isnan(v);
  /* Si la tensión falló, lo demás son valores viejos de la biblioteca: no se usan. */
  float i = red ? s_pzem.current() : NAN, p = red ? s_pzem.power() : NAN, e = red ? s_pzem.energy() : NAN;
  float f = red ? s_pzem.frequency() : NAN, fp = red ? s_pzem.pf() : NAN;
  const char *err = red ? nullptr : "PZEM sin respuesta (sin tensión de red o desconectado)";
  float temp = s_dht.readTemperature();

  const Medida m[] = {
      {"PZEM-V-" ESTACION_ID, "tension", "V", v, err, 1},
      {"PZEM-I-" ESTACION_ID, "corriente", "A", i, err, 3},
      {"PZEM-P-" ESTACION_ID, "potencia", "W", p, err, 1},
      {"PZEM-E-" ESTACION_ID, "energia", "kWh", e, err, 3},
      {"PZEM-F-" ESTACION_ID, "frecuencia", "Hz", f, err, 1},
      {"PZEM-FP-" ESTACION_ID, "factor_potencia", "1", fp, err, 2},
      {"DHT22-T-" ESTACION_ID, "temperatura", "degC", temp, "DHT22 sin respuesta", 1},
  };
  int n = mensaje_json(t, calidad, m, 7, s_pendiente, sizeof s_pendiente);
  if (n < 0) { Serial.println("# mensaje demasiado largo; revisar MSG_MAX"); return; }
  s_pendiente_n = n;
#if MENSAJE_POR_SERIE
  Serial.printf("V=%.1f I=%.3f P=%.1f E=%.3f T=%.1f\n", v, i, p, e, temp);
#endif
}

static void mantener_red() {
  static uint32_t ultimo_wifi = 0, ultimo_mqtt = 0;
  uint32_t ahora = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (ahora - ultimo_wifi > 10000) { ultimo_wifi = ahora; WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_CLAVE); }
    return;
  }
  if (!s_mqtt.connected()) {
    if (ahora - ultimo_mqtt < 5000) return;
    ultimo_mqtt = ahora;
    if (!s_mqtt.connect(ESTACION_ID, ESTACION_ID, MQTT_CLAVE)) Serial.printf("# MQTT no conecta (código %d)\n", s_mqtt.state());
    return;
  }
  s_mqtt.loop();
  if (s_pendiente_n && s_mqtt.publish(s_topico, (const uint8_t *)s_pendiente, s_pendiente_n, false)) s_pendiente_n = 0;
}

void setup() {
  Serial.begin(115200);
  delay(1000);                              /* el PZEM no responde en los primeros 200 ms */
  Serial.println("# tablero " ESTACION_ID " " FIRMWARE_VER);
  s_dht.begin();
  snprintf(s_topico, sizeof s_topico, "shm/v1/%s/medida", ESTACION_ID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_CLAVE);
  s_mqtt.setServer(MQTT_SERVIDOR, MQTT_PUERTO);
  s_mqtt.setBufferSize(MSG_MAX + 100);
  sntp_set_time_sync_notification_cb(sincronizado);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
}

void loop() {
  static uint32_t ultima = 0;
  if (millis() - ultima >= INTERVALO_MS) { ultima = millis(); medir(); }
  mantener_red();
  delay(10);
}
