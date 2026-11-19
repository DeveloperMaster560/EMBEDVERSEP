/*
 * Ajustes de la estación ambiental. Lo secreto (Wi-Fi, clave MQTT) va en
 * secretos.h, que no se sube al repositorio.
 *
 * Pines, intervalo y calibración del suelo son los del sketch original del
 * ingeniero ambiental («Cacao Smart Monitor»).
 */
#pragma once

#define ESTACION_ID   "LAB-AMB-01"          /* = id en proyectos/<proyecto>/proyecto.json */
#define FIRMWARE_VER  "esp32-ambiente-0.1.0"

#define DHT_PIN   4
#define SOIL_PIN  34                        /* ADC1: funciona aunque el Wi-Fi esté encendido */
#define TRIG_PIN  5
#define ECHO_PIN  18
#define SDA_PIN   21
#define SCL_PIN   22

#define INTERVALO_MS  10000                 /* una lectura de todos los sensores cada 10 s */

/* Calibración del capacitivo: lectura cruda en aire seco y sumergido en agua.
   3000/1300 vienen del sketch original; REPETIR con el sensor y el suelo reales. */
#define SUELO_SECO    3000
#define SUELO_MOJADO  1300

/* 1 = también escribe cada mensaje por el puerto serie (115200). */
#define MENSAJE_POR_SERIE 1
