/*
 * esp32-mpu6050 - Estación de prueba para la plataforma SHM.
 *
 * ESP32 + MPU6050 → ventanas de 10 s a 100 Hz → registro JSON del contrato
 * (plataforma/contrato) → MQTT shm/v1/<ESTACION_ID>/registro.
 *
 * Bibliotecas (las mismas de tus sketches ESP32_A/B): PubSubClient,
 * Adafruit MPU6050, Adafruit Unified Sensor. Placa: «ESP32 Dev Module».
 *
 * Diseño:
 *  - El muestreo va en su propia tarea (núcleo 1, prioridad alta) con
 *    vTaskDelayUntil: el Wi-Fi y MQTT no le roban tiempo. Si aun así se
 *    atrasa, las muestras perdidas entran como huecos (NaN, DATA_GAP).
 *  - La hora es NTP. Sin hora no se abre ninguna ventana (no se inventa).
 *    Si NTP no resincroniza en 2 h, la ventana sale con HOLDOVER.
 *  - Los registros esperan en RAM (40 = ~6 min) si se cae la red, y salen en
 *    orden al volver.
 *  - Las muestras crudas NO se guardan (no hay microSD): «samples_file»
 *    dice «no-guardada/…» y el CRC permite contrastarlas si algún día se suben.
 *  - Sin calibración (calibration_id null): son las lecturas del sensor.
 */
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <Wire.h>
#include <esp_sntp.h>
#include <esp_timer.h>
#include <sys/time.h>

#include "config.h"
#include "secretos.h"
#include "ventana.h"

static const uint32_t N = (uint32_t)MUESTREO_HZ * VENTANA_S;   /* muestras por ventana */
static const int64_t PERIODO_US = 1000000LL / MUESTREO_HZ;
static const float LIMITE_SAT = 0.995f * RANGO_G * 9.80665f;

/* ---------- Muestreo (tarea en el núcleo 1) ---------- */

struct Bufer {
  float d[N * 3];
  int64_t inicio_ms;
  uint32_t fallos;
  uint8_t hora;
};
static Bufer s_buf[3];
static QueueHandle_t s_llenos, s_libres;   /* índices de búfer */
static volatile uint32_t s_ventanas_perdidas = 0;
static volatile int64_t s_ultima_sincro_us = 0;   /* esp_timer de la última sincronización NTP */
static Adafruit_MPU6050 s_mpu;

static void sincronizado(struct timeval *) { s_ultima_sincro_us = esp_timer_get_time(); }

static int64_t ahora_utc_ms() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

static bool hay_hora() { return s_ultima_sincro_us != 0; }

static uint8_t calidad_hora() {
  return esp_timer_get_time() - s_ultima_sincro_us > 2LL * 3600 * 1000000 ? shm::HORA_HOLDOVER : shm::HORA_NTP;
}

static void tarea_muestreo(void *) {
  int actual = -1;
  uint32_t i = 0;
  int64_t previo_us = 0;
  TickType_t despertar = xTaskGetTickCount();
  for (;;) {
    vTaskDelayUntil(&despertar, pdMS_TO_TICKS(1000 / MUESTREO_HZ));
    int64_t t_us = esp_timer_get_time();
    if (!hay_hora()) { previo_us = 0; continue; }   /* sin hora no se mide */

    if (actual < 0) {
      int idx;
      if (xQueueReceive(s_libres, &idx, 0) != pdTRUE) { s_ventanas_perdidas++; continue; }
      actual = idx;
      i = 0;
      s_buf[actual].inicio_ms = ahora_utc_ms();
      s_buf[actual].fallos = 0;
      s_buf[actual].hora = calidad_hora();
      previo_us = t_us;
    }
    Bufer &b = s_buf[actual];

    /* Ticks atrasados: huecos, nunca muestras inventadas. */
    if (previo_us && i > 0) {
      int64_t perdidas = (t_us - previo_us + PERIODO_US / 2) / PERIODO_US - 1;
      while (perdidas-- > 0 && i < N - 1) {
        b.d[i * 3] = b.d[i * 3 + 1] = b.d[i * 3 + 2] = NAN;
        i++;
      }
    }
    previo_us = t_us;

    sensors_event_t a, g, temp;
    if (s_mpu.getEvent(&a, &g, &temp)) {
      b.d[i * 3] = a.acceleration.x;
      b.d[i * 3 + 1] = a.acceleration.y;
      b.d[i * 3 + 2] = a.acceleration.z;
    } else {
      b.d[i * 3] = b.d[i * 3 + 1] = b.d[i * 3 + 2] = NAN;
      b.fallos++;
    }
    if (++i >= N) {
      xQueueSend(s_llenos, &actual, 0);   /* hay sitio: la cola mide lo mismo que los búferes */
      actual = -1;
    }
  }
}

/* ---------- Registros y red (loop, núcleo 1 con prioridad normal) ---------- */

#define COLA 40
#define REG_MAX 1200
static char s_cola[COLA][REG_MAX];
static uint16_t s_cola_len[COLA];
static int s_cola_ini = 0, s_cola_n = 0;
static uint32_t s_secuencia = 0, s_descartados = 0;

static WiFiClient s_wifi;
static PubSubClient s_mqtt(s_wifi);
static char s_topico[64], s_topico_estado[64];

static void encolar(const char *json, int len) {
  if (s_cola_n == COLA) {          /* cola llena: se pierde el más viejo y se cuenta */
    s_cola_ini = (s_cola_ini + 1) % COLA;
    s_cola_n--;
    s_descartados++;
  }
  int k = (s_cola_ini + s_cola_n) % COLA;
  memcpy(s_cola[k], json, (size_t)len + 1);
  s_cola_len[k] = (uint16_t)len;
  s_cola_n++;
}

static void cerrar_ventana(int idx) {
  Bufer &b = s_buf[idx];
  shm::Resumen r{};
  r.secuencia = s_secuencia++;
  r.inicio_utc_ms = b.inicio_ms;
  r.hora = (shm::Hora)b.hora;
  r.fallos_sensor = b.fallos;
  shm::resumir(b.d, N, LIMITE_SAT, r);
  xQueueSend(s_libres, &idx, 0);   /* el búfer vuelve al muestreo cuanto antes */

  static const shm::Ajustes AJ = {ESTACION_ID, SENSOR_ID, FIRMWARE_VER, FILTRO_ID, (float)MUESTREO_HZ, (float)RANGO_G};
  char extra[48];
  snprintf(extra, sizeof extra, "\"rssi_dbm\":%d", WiFi.status() == WL_CONNECTED ? (int)WiFi.RSSI() : 0);
  static char json[REG_MAX];
  int len = shm::registro_json(AJ, r, json, sizeof json, WiFi.status() == WL_CONNECTED ? extra : nullptr);
  if (len < 0) { Serial.println("# ERROR: el registro no cabe"); return; }
#if REGISTRO_POR_SERIE
  Serial.print("SHM ");
  Serial.println(json);
#endif
  encolar(json, len);
}

static uint32_t s_wifi_intento = 0, s_mqtt_intento = 0, s_estado_ms = 0;

static void mantener_red() {
  uint32_t ahora = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (ahora - s_wifi_intento > 10000 || s_wifi_intento == 0) {
      s_wifi_intento = ahora;
      Serial.println("# Conectando al Wi-Fi…");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_CLAVE);
    }
    return;
  }
  if (!s_mqtt.connected()) {
    if (ahora - s_mqtt_intento > 5000 || s_mqtt_intento == 0) {
      s_mqtt_intento = ahora;
      /* Usuario = ID de la estación; el broker solo la deja escribir en su rama. */
      if (s_mqtt.connect(ESTACION_ID, ESTACION_ID, MQTT_CLAVE)) {
        Serial.println("# MQTT conectado a la plataforma");
      } else {
        /* 4 = usuario/clave mal; 5 = no autorizado; -2 = no llega al servidor (IP, puerto, cortafuegos). */
        Serial.printf("# MQTT no conecta (código %d)\n", s_mqtt.state());
      }
    }
    return;
  }
  s_mqtt.loop();
  /* Vaciar la cola: uno por vuelta, para no tener el bucle ocupado mucho rato. */
  if (s_cola_n > 0) {
    if (s_mqtt.publish(s_topico, (const uint8_t *)s_cola[s_cola_ini], s_cola_len[s_cola_ini], false)) {
      s_cola_ini = (s_cola_ini + 1) % COLA;
      s_cola_n--;
    }
  }
  if (ahora - s_estado_ms > 60000) {
    s_estado_ms = ahora;
    char est[200];
    snprintf(est, sizeof est,
             "{\"uptime_s\":%lu,\"rssi_dbm\":%d,\"heap_libre\":%lu,\"en_cola\":%d,\"descartados\":%lu,\"ventanas_perdidas\":%lu}",
             (unsigned long)(ahora / 1000), (int)WiFi.RSSI(), (unsigned long)ESP.getFreeHeap(), s_cola_n,
             (unsigned long)s_descartados, (unsigned long)s_ventanas_perdidas);
    s_mqtt.publish(s_topico_estado, est);
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.printf("\n# %s %s arrancando\n", ESTACION_ID, FIRMWARE_VER);

  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(400000);
  while (!s_mpu.begin()) {
    Serial.println("# ERROR: MPU6050 no detectado (revisa SDA 21, SCL 22, 3V3, GND); reintento en 2 s");
    delay(2000);
  }
  s_mpu.setAccelerometerRange(RANGO_G == 2 ? MPU6050_RANGE_2_G : RANGO_G == 8 ? MPU6050_RANGE_8_G
                              : RANGO_G == 16 ? MPU6050_RANGE_16_G : MPU6050_RANGE_4_G);
  s_mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  Serial.println("# MPU6050 listo");

  snprintf(s_topico, sizeof s_topico, "shm/v1/%s/registro", ESTACION_ID);
  snprintf(s_topico_estado, sizeof s_topico_estado, "shm/v1/%s/estado", ESTACION_ID);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  s_mqtt.setServer(MQTT_SERVIDOR, MQTT_PUERTO);
  s_mqtt.setBufferSize(REG_MAX + 100);
  s_mqtt.setSocketTimeout(3);

  sntp_set_time_sync_notification_cb(sincronizado);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  Serial.println("# Esperando la hora NTP (sin hora no se mide)…");

  s_llenos = xQueueCreate(3, sizeof(int));
  s_libres = xQueueCreate(3, sizeof(int));
  for (int k = 0; k < 3; k++) xQueueSend(s_libres, &k, 0);
  xTaskCreatePinnedToCore(tarea_muestreo, "muestreo", 4096, nullptr, configMAX_PRIORITIES - 2, nullptr, 1);
}

void loop() {
  static bool avisado = false;
  if (hay_hora() && !avisado) {
    avisado = true;
    Serial.println("# Hora NTP lista: empieza la medición");
  }
  int idx;
  if (xQueueReceive(s_llenos, &idx, 0) == pdTRUE) cerrar_ventana(idx);
  mantener_red();
  delay(5);
}
