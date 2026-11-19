# Licencias de la biblioteca oficial

Generado por `scripts/biblioteca_oficial.py` (con `scripts/licencias.py`) a partir del `.zip` verificado de cada biblioteca. **No es asesoría legal**: es el inventario para que lo revise un abogado antes de abrir el servicio al público.

| Grupo | Bibliotecas | Qué obliga al entregar un firmware |
|---|---|---|
| gpl | 7 | Quien entregue el equipo debe entregar el código fuente de TODO el firmware bajo la GPL. Para un producto cerrado: cambiar de biblioteca o pedir otra licencia al autor. |
| desconocida | 4 | Sin licencia no hay permiso: pedírsela al autor o cambiar de biblioteca antes de vender equipos. |
| propia | 1 | Licencia escrita por el autor: vale lo que diga su texto. NewPing: se puede usar tal cual (privado y comercial), pero no modificarla ni publicar versiones derivadas. |
| lgpl | 12 | Aviso y licencia; además entregar (o ofrecer) el código de la biblioteca y la forma de volver a enlazar el firmware con una versión modificada de ella (en Arduino: el proyecto completo y la versión exacta). |
| permisiva | 94 | Incluir el aviso de copyright y la licencia con el firmware que se entrega. |

| Biblioteca | Versión | Licencia | Grupo | De dónde |
|---|---|---|---|---|
| AccelStepper | 1.64.0 | GPL-3.0 | gpl | LICENSE |
| CQRobotTDS | 0.1.1 | GPL-3.0 | gpl | LICENSE |
| DHT sensor library for ESPx | 1.19.0 | GPL-3.0 | gpl | LICENSE |
| EmonLib | 1.1.0 | GPL-2.0 | gpl | cabecera de EmonLib.h |
| ModbusMaster | 2.0.1 | Apache-2.0 AND GPL-3.0 | gpl | LICENSE; además GPL-3.0 en src/util/word.h |
| SD | 1.3.0 | GPL-3.0 | gpl | LICENSE.txt |
| SdFat | 2.3.0 | MIT AND GPL-3.0 | gpl | LICENSE.md; además GPL-3.0 en src/DigitalIO/SoftSPI.h |
| LiquidCrystal | 1.0.7 | — | desconocida | sin archivo de licencia ni aviso en las cabeceras |
| LiquidCrystal I2C | 1.1.2 | — | desconocida | sin archivo de licencia ni aviso en las cabeceras |
| TFLI2C | 0.2.0 | — | desconocida | sin archivo de licencia ni aviso en las cabeceras |
| TFMPlus | 1.5.0 | — | desconocida | sin archivo de licencia ni aviso en las cabeceras |
| NewPing | 1.9.7 | LicenseRef-uso-sin-modificar | propia | cabecera de src/NewPing.h |
| Adafruit NeoPixel | 1.15.5 | LGPL-3.0 | lgpl | COPYING |
| Adafruit seesaw Library | 1.7.9 | LGPL-3.0 | lgpl | cabecera de seesaw_neopixel.h |
| Arduino_BMI270_BMM150 | 1.2.4 | LGPL-2.1 | lgpl | LICENSE |
| Arduino_LSM6DS3 | 1.1.0 | LGPL-2.1 | lgpl | LICENSE.txt |
| ArduinoModbus | 1.0.9 | LGPL-2.1 | lgpl | cabecera de src/ModbusServer.h |
| ArduinoMqttClient | 0.1.8 | LGPL-2.1 | lgpl | LICENSE.txt |
| ArduinoRS485 | 1.1.1 | LGPL-2.1 | lgpl | LICENSE.txt |
| ESP32Servo | 3.2.1 | LGPL-2.1 | lgpl | cabecera de src/ESP32Servo.h |
| Ethernet | 2.0.2 | Apache-2.0 AND LGPL-2.1 | lgpl | cabecera de src/Dns.h; además LGPL-2.1 en src/utility/w5100.h |
| MCCI LoRaWAN LMIC library | 6.1.0 | MIT AND LGPL-3.0 | lgpl | LICENSE; además LGPL-3.0 en src/aes/ideetron/AES-128_V10.cpp |
| Servo | 1.3.0 | LGPL-2.1 | lgpl | LICENSE.txt |
| TinyGPSPlus | 1.0.3 | LGPL-2.1 | lgpl | cabecera de src/TinyGPS++.h |
| Adafruit ADS1X15 | 2.6.2 | BSD-3-Clause | permisiva | license.txt |
| Adafruit ADXL343 | 1.6.4 | BSD-3-Clause | permisiva | license.txt |
| Adafruit ADXL345 | 1.3.4 | BSD-3-Clause | permisiva | license.txt |
| Adafruit ADXL375 | 1.1.2 | BSD-3-Clause | permisiva | license.txt |
| Adafruit AHTX0 | 2.0.6 | BSD-3-Clause | permisiva | license.txt |
| Adafruit BME280 Library | 2.3.0 | BSD-3-Clause | permisiva | LICENSE |
| Adafruit BME680 Library | 2.0.6 | BSD-3-Clause | permisiva | cabecera de bme68x.h |
| Adafruit BMP280 Library | 3.0.0 | MIT | permisiva | LICENSE.txt |
| Adafruit BNO055 | 1.6.4 | MIT | permisiva | LICENSE |
| Adafruit BNO08x | 1.2.7 | BSD-3-Clause | permisiva | license.txt |
| Adafruit BusIO | 1.17.4 | MIT | permisiva | LICENSE |
| Adafruit CCS811 Library | 1.1.3 | MIT | permisiva | LICENSE |
| Adafruit GFX Library | 1.13.0 | BSD-3-Clause | permisiva | license.txt |
| Adafruit GPS Library | 1.9.0 | BSD-3-Clause | permisiva | license.txt |
| Adafruit HTU21DF Library | 1.1.2 | BSD-3-Clause | permisiva | cabecera de Adafruit_HTU21DF.cpp |
| Adafruit ICM20X | 2.0.7 | BSD-3-Clause | permisiva | license.txt |
| Adafruit ILI9341 | 1.7.0 | BSD-3-Clause | permisiva | cabecera de Adafruit_ILI9341.h |
| Adafruit INA219 | 1.2.3 | BSD-3-Clause | permisiva | license.txt |
| Adafruit INA260 Library | 1.5.4 | BSD-3-Clause | permisiva | license.txt |
| Adafruit LIS3DH | 1.3.0 | BSD-3-Clause | permisiva | license.txt |
| Adafruit LIS3MDL | 1.2.5 | BSD-3-Clause | permisiva | license.txt |
| Adafruit LSM6DS | 4.7.4 | BSD-3-Clause | permisiva | license.txt |
| Adafruit MAX31855 library | 1.4.2 | BSD-3-Clause | permisiva | license.txt |
| Adafruit MAX31865 library | 1.6.2 | BSD-3-Clause | permisiva | cabecera de Adafruit_MAX31865.h |
| Adafruit MCP3008 | 1.3.3 | MIT | permisiva | LICENSE |
| Adafruit MCP9808 Library | 2.0.2 | BSD-3-Clause | permisiva | license.txt |
| Adafruit MLX90614 Library | 2.1.7 | BSD-3-Clause | permisiva | license.txt |
| Adafruit MMA8451 Library | 1.2.3 | BSD-3-Clause | permisiva | license.txt |
| Adafruit MPU6050 | 2.2.9 | BSD-3-Clause | permisiva | license.txt |
| Adafruit NAU7802 Library | 1.0.8 | BSD-3-Clause | permisiva | license.txt |
| Adafruit PM25 AQI Sensor | 2.0.0 | BSD-3-Clause | permisiva | license.txt |
| Adafruit SCD30 | 1.0.11 | BSD-3-Clause | permisiva | license.txt |
| Adafruit SGP30 Sensor | 2.0.3 | BSD-3-Clause | permisiva | license.txt |
| Adafruit SH110X | 2.1.15 | BSD-3-Clause | permisiva | license.txt |
| Adafruit SHT31 Library | 2.2.2 | BSD-3-Clause | permisiva | license.txt |
| Adafruit SHT4x Library | 1.0.5 | BSD-3-Clause | permisiva | license.txt |
| Adafruit Si7021 Library | 1.5.3 | BSD-3-Clause | permisiva | cabecera de Adafruit_Si7021.h |
| Adafruit SSD1306 | 2.5.17 | BSD-3-Clause | permisiva | license.txt |
| Adafruit ST7735 and ST7789 Library | 1.12.0 | MIT | permisiva | cabecera de Adafruit_ST77xx.h |
| Adafruit STMPE610 | 1.1.6 | MIT | permisiva | LICENSE |
| Adafruit TMP117 | 1.0.5 | BSD-3-Clause | permisiva | license.txt |
| Adafruit TouchScreen | 1.1.6 | BSD-3-Clause | permisiva | license.txt |
| Adafruit TSC2007 | 1.1.2 | BSD-3-Clause | permisiva | license.txt |
| Adafruit TSL2561 | 1.1.3 | BSD-3-Clause | permisiva | cabecera de Adafruit_TSL2561_U.h |
| Adafruit TSL2591 Library | 1.4.5 | BSD-3-Clause | permisiva | cabecera de Adafruit_TSL2591.cpp |
| Adafruit Unified Sensor | 1.1.15 | Apache-2.0 | permisiva | LICENSE.txt |
| Adafruit VEML6070 Library | 1.0.8 | BSD-3-Clause | permisiva | cabecera de Adafruit_VEML6070.h |
| Adafruit VEML7700 Library | 2.1.6 | BSD-3-Clause | permisiva | license.txt |
| Adafruit VL53L1X | 3.1.2 | BSD-3-Clause | permisiva | LICENSE.md |
| Adafruit_VL53L0X | 1.2.5 | BSD-3-Clause | permisiva | cabecera de src/vl53l0x_def.h |
| ADS1220_WE | 1.0.25 | MIT | permisiva | LICENSE |
| ADS1256 | 1.6.0 | MIT | permisiva | LICENSE |
| ADS1X15 | 0.6.2 | MIT | permisiva | LICENSE |
| ADXL345_WE | 3.1.0 | MIT | permisiva | LICENSE |
| ArduinoHttpClient | 0.6.2 | Apache-2.0 | permisiva | LICENSE.txt |
| ArduinoJson | 7.4.3 | MIT | permisiva | LICENSE.txt |
| AUnit | 1.7.1 | MIT | permisiva | LICENSE |
| BH1750 | 1.3.0 | MIT | permisiva | LICENSE |
| DallasTemperature | 4.0.6 | MIT | permisiva | LICENSE |
| DFRobot_PH | 1.0.0 | MIT | permisiva | LICENSE |
| DHT sensor library | 1.4.7 | MIT | permisiva | license.txt |
| HX711 Arduino Library | 0.7.5 | MIT | permisiva | LICENSE |
| HX711_ADC | 1.2.12 | MIT | permisiva | LICENSE |
| INA226 | 0.6.6 | MIT | permisiva | LICENSE |
| LoRa | 0.8.0 | MIT | permisiva | LICENSE |
| MAX6675 library | 1.1.2 | BSD-3-Clause | permisiva | license.txt |
| MPU6050 | 1.4.5 | MIT | permisiva | LICENSE |
| MPU9250 | 0.4.8 | MIT | permisiva | LICENSE |
| MQUnifiedsensor | 3.0.0 | MIT | permisiva | LICENSE |
| Nova Fitness Sds dust sensors library | 1.5.1 | MIT | permisiva | LICENSE |
| OneWire | 2.3.8 | MIT | permisiva | cabecera de OneWire.cpp |
| PL ADXL355 | 1.4.2 | MIT | permisiva | LICENSE |
| ProtoCentral ADS1220 24-bit ADC Library | 1.2.1 | MIT | permisiva | LICENSE.md |
| ProtoCentral ADS1262 32-bit precision ADC Library | 2.0.0 | MIT | permisiva | LICENSE |
| PubSubClient | 2.8.0 | MIT | permisiva | LICENSE.txt |
| PZEM004Tv30 | 1.2.1 | MIT | permisiva | LICENSE |
| RadioLib | 7.8.1 | MIT | permisiva | license.txt |
| RTClib | 2.1.4 | MIT | permisiva | license.txt |
| SCL3300 | 3.3.1 | MIT | permisiva | LICENSE |
| Sensirion Core | 0.7.3 | BSD-3-Clause | permisiva | LICENSE |
| Sensirion I2C SCD4x | 1.1.0 | BSD-3-Clause | permisiva | LICENSE |
| SparkFun 9DoF IMU Breakout - ICM 20948 - Arduino Library | 1.3.2 | MIT | permisiva | License.md |
| SparkFun Indoor Air Quality Sensor - ENS160 | 1.1.0 | MIT | permisiva | License.md |
| SparkFun MMA8452Q Accelerometer | 1.4.0 | Beerware | permisiva | LICENSE.md |
| SparkFun Qwiic Scale NAU7802 Arduino Library | 1.0.6 | MIT | permisiva | LICENSE.md |
| SparkFun SCD30 Arduino Library | 1.0.20 | MIT | permisiva | LICENSE.md |
| SparkFun SGP40 Arduino Library | 1.0.4 | MIT | permisiva | LICENSE.md |
| SparkFun u-blox GNSS v3 | 3.1.15 | MIT | permisiva | LICENSE.md |
| SparkFun VL53L1X 4m Laser Distance Sensor | 1.2.12 | MIT | permisiva | LICENSE.md |
| SparkFun Weather Meter Kit Arduino Library | 1.1.2 | MIT | permisiva | LICENSE.md |
| U8g2 | 2.36.19 | BSD-2-Clause | permisiva | LICENSE |
| VL53L0X | 1.3.1 | BSD-3-Clause | permisiva | LICENSE.txt |
| VL53L1X | 1.3.1 | BSD-3-Clause | permisiva | LICENSE.txt |
| WiFiManager | 2.0.17 | MIT | permisiva | LICENSE |
