/*
 * Estación ambiental SHM (ESP32): DHT22 + humedad de suelo capacitiva +
 * BH1750 + HC-SR04, enviando al contrato de MEDIDAS de la plataforma.
 *
 * Es el «Cacao Smart Monitor» del ingeniero ambiental, con estos cambios:
 *  - Tópico shm/v1/<ID>/medida y formato del contrato (medidas.h), no
 *    cacao/estacion001/telemetria. Usuario MQTT = ID de la estación.
 *  - Sensor sin lectura → "value": null + "error"; nunca -999.
 *  - Hora UTC por NTP en cada mensaje; sin hora válida no se envía nada.
 *    Si NTP no resincroniza en 2 h, la hora sale como HOLDOVER.
 *  - SIN alertas en el equipo: los umbrales (temperatura, humedad, proximidad…)
 *    los firma el ingeniero en el proyecto y los aplica la plataforma.
 *  - Sin ArduinoJson (el mensaje se arma en medidas.h, probado en el PC).
 *  - Si la red cae, guarda hasta COLA mensajes en RAM y los manda al volver.
 *
 * Bibliotecas: «DHT sensor library» (Adafruit, instala también «Adafruit
 * Unified Sensor»), «BH1750» (claws) y «PubSubClient». Núcleo: esp32:esp32.
 *   sh scripts/placas.sh nucleo esp32-devkit
 *   sh scripts/placas.sh biblioteca "DHT sensor library" "BH1750" "PubSubClient"
 */
#include <BH1750.h>
#include <DHT.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <Wire.h>
#include <esp_sntp.h>
#include <esp_timer.h>
#include <sys/time.h>

#include "config.h"
#include "medidas.h"
#include "secretos.h"

static const int COLA = 30;          /* 30 mensajes × 10 s = 5 min sin red */
static const int MSG_MAX = 1024;

static DHT s_dht(DHT_PIN, DHT22);
static BH1750 s_luz;
static bool s_luz_ok = false;
static WiFiClient s_red;
static PubSubClient s_mqtt(s_red);

static char s_cola[COLA][MSG_MAX];
static int s_cola_len[COLA];
static int s_cola_ini = 0, s_cola_n = 0;
static uint32_t s_descartados = 0, s_sin_hora = 0;

static volatile int64_t s_ultima_sincro_us = 0;
static char s_topico[48], s_topico_estado[48];

static void sincronizado(struct timeval *) { s_ultima_sincro_us = esp_timer_get_time(); }

static int64_t ahora_utc_ms() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

static const char *calidad_hora() {
  return esp_timer_get_time() - s_ultima_sincro_us > 2LL * 3600 * 1000000 ? "HOLDOVER" : "NTP";
}

static void encolar(const char *msg, int n) {
  if (s_cola_n == COLA) {           /* llena: se pierde el más viejo, y se cuenta */
    s_cola_ini = (s_cola_ini + 1) % COLA;
    s_cola_n--;
    s_descartados++;
  }
  int i = (s_cola_ini + s_cola_n) % COLA;
  memcpy(s_cola[i], msg, n);
  s_cola_len[i] = n;
  s_cola_n++;
}

static void medir() {
  if (s_ultima_sincro_us == 0) {    /* sin hora no hay medida: no se inventa el instante */
    s_sin_hora++;
    Serial.println("# esperando hora NTP; no se envía nada");
    return;
  }
  int64_t t = ahora_utc_ms();

  float temp = s_dht.readTemperature();
  float hum = s_dht.readHumidity();
  const char *err_dht = (isnan(temp) || isnan(hum)) ? "DHT22 sin respuesta" : nullptr;

  float lux = s_luz_ok ? s_luz.readLightLevel() : NAN;
  if (lux < 0) lux = NAN;            /* la biblioteca devuelve negativo si falla */

  int crudo = analogRead(SOIL_PIN);
  float suelo = medidas::suelo_porcentaje(crudo, SUELO_SECO, SUELO_MOJADO);

  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  float cm = medidas::eco_a_cm(pulseIn(ECHO_PIN, HIGH, 30000));

  const medidas::Medida m[] = {
      {"DHT22-T-" ESTACION_ID, "temperatura", "degC", temp, err_dht, 1},
      {"DHT22-H-" ESTACION_ID, "humedad", "%HR", hum, err_dht, 1},
      {"SUELO-" ESTACION_ID, "humedad_suelo", "%", suelo, nullptr, 0},
      {"BH1750-" ESTACION_ID, "luz", "lux", lux, s_luz_ok ? "BH1750 sin respuesta" : "BH1750 no detectado al arrancar", 1},
      {"HCSR04-" ESTACION_ID, "distancia", "cm", cm, "sin eco (nada a su alcance o sensor desconectado)", 1},
  };
  static char msg[MSG_MAX];
  int n = medidas::mensaje_json(ESTACION_ID, FIRMWARE_VER, t, calidad_hora(), m, 5, msg, sizeof msg);
  if (n < 0) {
    Serial.println("# mensaje demasiado largo; revisar MSG_MAX");
    return;
  }
#if MENSAJE_POR_SERIE
  Serial.print("MEDIDA ");
  Serial.println(msg);
#endif
  encolar(msg, n);
}

static void mantener_red() {
  static uint32_t ultimo_wifi = 0, ultimo_mqtt = 0;
  uint32_t ahora = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (ahora - ultimo_wifi > 10000) {
      ultimo_wifi = ahora;
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_CLAVE);
    }
    return;
  }
  if (!s_mqtt.connected()) {
    if (ahora - ultimo_mqtt < 5000) return;
    ultimo_mqtt = ahora;
    if (s_mqtt.connect(ESTACION_ID, ESTACION_ID, MQTT_CLAVE)) Serial.println("# MQTT conectado");
    else Serial.printf("# MQTT no conecta (código %d)\n", s_mqtt.state());
    return;
  }
  s_mqtt.loop();
  if (s_cola_n > 0 &&
      s_mqtt.publish(s_topico, (const uint8_t *)s_cola[s_cola_ini], s_cola_len[s_cola_ini], false)) {
    s_cola_ini = (s_cola_ini + 1) % COLA;
    s_cola_n--;
  }
  static uint32_t ultimo_estado = 0;
  if (ahora - ultimo_estado > 60000) {
    ultimo_estado = ahora;
    char est[200];
    snprintf(est, sizeof est,
             "{\"uptime_s\":%lu,\"rssi_dbm\":%d,\"heap_libre\":%u,\"en_cola\":%d,\"descartados\":%lu,\"sin_hora\":%lu}",
             (unsigned long)(ahora / 1000), WiFi.RSSI(), (unsigned)ESP.getFreeHeap(), s_cola_n,
             (unsigned long)s_descartados, (unsigned long)s_sin_hora);
    s_mqtt.publish(s_topico_estado, est);
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("# estación ambiental " ESTACION_ID " " FIRMWARE_VER);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(SOIL_PIN, ADC_11db);   /* 0–3,3 V completos en el ADC */
  s_dht.begin();
  Wire.begin(SDA_PIN, SCL_PIN);
  s_luz_ok = s_luz.begin(BH1750::CONTINUOUS_HIGH_RES_MODE);
  if (!s_luz_ok) Serial.println("# BH1750 no responde en I2C (0x23): revisar SDA/SCL/ADDR");

  snprintf(s_topico, sizeof s_topico, "shm/v1/%s/medida", ESTACION_ID);
  snprintf(s_topico_estado, sizeof s_topico_estado, "shm/v1/%s/estado", ESTACION_ID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_CLAVE);
  s_mqtt.setServer(MQTT_SERVIDOR, MQTT_PUERTO);
  s_mqtt.setBufferSize(MSG_MAX + 100);
  s_mqtt.setSocketTimeout(3);
  sntp_set_time_sync_notification_cb(sincronizado);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
}

void loop() {
  static uint32_t ultima = 0;
  /* El DHT22 necesita ≥2 s entre lecturas; INTERVALO_MS es 10 s. */
  if (millis() - ultima >= INTERVALO_MS) {
    ultima = millis();
    medir();
  }
  mantener_red();
  delay(10);
}
