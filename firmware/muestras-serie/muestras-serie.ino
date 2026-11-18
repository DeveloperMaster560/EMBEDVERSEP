/*
 * muestras-serie - MPU6050 → «x,y,z» en g por el puerto serie, a 100 Hz.
 *
 * Para CUALQUIER placa con Arduino (Uno, Nano, Mega, ESP32, ESP8266, STM32,
 * Pico…): no usa bibliotecas externas, solo Wire. En el PC, la pasarela serie
 * arma las ventanas y las publica en la plataforma:
 *
 *   cd plataforma/servicios
 *   py -m shm_plataforma.pasarela_serie --estacion LAB-SERIE-01 --puerto COM5 --hz 100 --unidad g --rango-g 4
 *
 * Conexión: VCC→3V3 (o 5V si tu módulo GY-521 trae regulador), GND→GND,
 * SDA/SCL a los pines I2C de la placa (Uno/Nano: A4/A5; ESP32: 21/22).
 * Si la lectura falla se imprime una línea «hueco»: la pasarela la cuenta como
 * hueco, nunca como cero.
 */
#include <Wire.h>

const uint8_t MPU = 0x68;           // 0x69 si AD0 está a 3V3
const uint32_t PERIODO_US = 10000;  // 100 Hz
const float LSB_POR_G = 8192.0;     // ±4 g

static void escribir(uint8_t reg, uint8_t valor) {
  Wire.beginTransmission(MPU);
  Wire.write(reg);
  Wire.write(valor);
  Wire.endTransmission();
}

static bool iniciar() {
  Wire.beginTransmission(MPU);
  Wire.write(0x75);                 // WHO_AM_I
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU, (uint8_t)1) != 1) return false;
  Wire.read();
  escribir(0x6B, 0x01);             // despertar, reloj del giróscopo X
  escribir(0x1A, 0x04);             // filtro digital ~21 Hz
  escribir(0x1C, 0x08);             // ±4 g
  return true;
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  Wire.setClock(400000);
  delay(100);
  while (!iniciar()) {
    Serial.println("# MPU6050 no responde (revisa SDA, SCL, VCC, GND); reintento");
    delay(2000);
  }
  Serial.println("# MPU6050 listo: x,y,z en g a 100 Hz");
}

void loop() {
  static uint32_t proximo = micros();
  while ((int32_t)(micros() - proximo) < 0) {}
  proximo += PERIODO_US;

  Wire.beginTransmission(MPU);
  Wire.write(0x3B);                 // ACCEL_XOUT_H
  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(MPU, (uint8_t)6) != 6) {
    Serial.println("hueco");
    return;
  }
  int16_t v[3];
  for (int i = 0; i < 3; i++) v[i] = (int16_t)((Wire.read() << 8) | Wire.read());
  Serial.print(v[0] / LSB_POR_G, 4);
  Serial.print(',');
  Serial.print(v[1] / LSB_POR_G, 4);
  Serial.print(',');
  Serial.println(v[2] / LSB_POR_G, 4);
}
