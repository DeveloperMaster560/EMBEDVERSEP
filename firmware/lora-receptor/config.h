#pragma once
// Pines del SX1276 (los de TTGO LoRa32 v1; cambiar según la placa).
#define LORA_NSS   18
#define LORA_DIO0  26
#define LORA_RST   14
#define LORA_DIO1  33
// Radio: debe coincidir con los nodos emisores. En Colombia la banda libre es 915 MHz.
#define LORA_MHZ    915.0
#define LORA_BW_KHZ 125.0
#define LORA_SF     9
#define LORA_CR     7
#define LORA_SYNC   0x12   // red privada (0x34 es LoRaWAN pública)
