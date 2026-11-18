/* config.h - Lo que no es secreto. Debe coincidir con proyectos/laboratorio/proyecto.json. */
#pragma once

#define ESTACION_ID     "LAB-ESP32-01"
#define SENSOR_ID       "MPU6050-LAB-ESP32-01"
#define FIRMWARE_VER    "esp32-mpu6050-0.1.0"

/* Igual que tus sketches ESP32_A/B: I2C en 21/22, ±4 g, filtro de 21 Hz, 100 Hz. */
#define PIN_SDA         21
#define PIN_SCL         22
#define MUESTREO_HZ     100
#define RANGO_G         4
#define FILTRO_ID       "mpu6050-dlpf-21hz"
#define VENTANA_S       10      /* un registro cada 10 s, como el resto de estaciones */

/*
 * 1 = además de MQTT, imprime cada registro por el puerto serie con el prefijo
 * «SHM »: sirve para la pasarela serie (sin Wi-Fi) y para ver qué se envía.
 */
#define REGISTRO_POR_SERIE 1
