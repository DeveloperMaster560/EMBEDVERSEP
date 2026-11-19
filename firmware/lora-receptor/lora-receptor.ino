// Receptor LoRa → USB: imprime cada paquete recibido, tal cual, en una línea.
//
// No interpreta nada: la pasarela del PC (pasarela_serie --proyecto) reparte
// cada línea a su estación por el prefijo («AGUA,19.5,3.2,7.1») y lee los
// valores según la «lectura» de cada sensor en proyecto.json. Así se pueden
// añadir nodos sin tocar este firmware.
//
// Placa: ESP32 con un módulo SX1276/SX1278 (Heltec, TTGO LoRa32 o módulo
// suelto). Pines y frecuencia en config.h. Biblioteca: RadioLib (oficial).
// ESTADO: escrito, sin compilar ni probar con radio (no hay hardware aquí).
#include <RadioLib.h>
#include "config.h"

SX1276 radio = new Module(LORA_NSS, LORA_DIO0, LORA_RST, LORA_DIO1);
volatile bool llego = false;

#if defined(ESP32)
IRAM_ATTR
#elif defined(ESP8266)
ICACHE_RAM_ATTR
#endif
void alRecibir() { llego = true; }

void setup() {
  Serial.begin(115200);
  int estado = radio.begin(LORA_MHZ, LORA_BW_KHZ, LORA_SF, LORA_CR, LORA_SYNC);
  if (estado != RADIOLIB_ERR_NONE) {
    Serial.printf("# LoRa no responde (código %d): revisa pines y alimentación\n", estado);
    while (true) delay(1000);
  }
  radio.setPacketReceivedAction(alRecibir);
  radio.startReceive();
  Serial.printf("# receptor LoRa listo en %.1f MHz, SF%d\n", LORA_MHZ, LORA_SF);
}

void loop() {
  if (!llego) return;
  llego = false;
  String paquete;
  int estado = radio.readData(paquete);
  if (estado == RADIOLIB_ERR_NONE) {
    paquete.trim();
    // Sin saltos de línea dentro: la pasarela trabaja por líneas.
    paquete.replace("\n", " ");
    paquete.replace("\r", " ");
    Serial.println(paquete);
    Serial.printf("# rssi %.0f dBm  snr %.1f dB\n", radio.getRSSI(), radio.getSNR());
  } else if (estado == RADIOLIB_ERR_CRC_MISMATCH) {
    Serial.println("# paquete con CRC incorrecto: descartado");
  }
  radio.startReceive();
}
