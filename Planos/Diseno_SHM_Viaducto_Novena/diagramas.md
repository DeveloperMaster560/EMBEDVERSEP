# Diagramas de arquitectura e instalación

## 1. Arquitectura física de puente

```text
                     [GNSS antenna / open sky]
                               |
                             PPS
                               |
 [SD-i-1]------ [SD-i-2]------ [SD-i-3]------ [SD-i+1-1] ...
  L_i/4          L_i/2         3L_i/4
   |               |              |
 ADXL355        ADXL355        ADXL355
 MCU + local    MCU + local    MCU + local
 storage        storage        storage
   |               |              |
   +-------- Ethernet/LTE file backhaul -------+
   +-------- LoRaWAN summary/health only -------+--> Gateway
                                                         |
                                                   IP backhaul

 Static sites at selected supports/joints:
 [SCL3300 + Pt100] and, only if justified, [strain / LVDT]
```

El diagrama es topológico, no representa la geometría verdadera ni una cantidad final de nodos. `i` representa una luz identificada en planos y en inspección. Todos los nodos conservan datos locales si el backhaul falla.

## 2. Arquitectura interna de estación

```text
24 VDC or solar battery
       |
 [F1 / reverse polarity / TVS / EMI filter]
       +-------------------------+
       |                         |
 [isolated DC/DC digital]  [low-noise analog DC/DC]
       |                         |
 STM32H743VIT6 <--- SPI2 ---> ADXL355, SCL3300, ADS1262
       |            |              |
       |            +-- DRDY ------+
       |
       +-- SDMMC --> industrial microSD/eMMC
       +-- UART <--- GNSS time, plus PPS to timer capture
       +-- Ethernet/LTE --> raw data files and management
       +-- LoRaWAN --> health/status/compact summaries only
       |
       +-- ADS1262 module --> bridge, 4-wire Pt100,
                              isolated 4-20 mA receiver
```

## 3. Cableado de sensores

```text
ADXL355 (rigidly fixed to structure)
  | short PCB traces / board-to-board connector
  +-- 3V3, GND, SCK, MISO, MOSI, CS, INT
  |
SCL3300 (if used at that site)
  +-- 3V3, GND, shared SPI SCK/MISO/MOSI, independent CS

Strain bridge at structural surface
  | 6-wire shielded twisted cable (short, protected route)
  +-- EXC+, EXC-, SIG+, SIG-, SENSE+, SENSE-
  |
Local ADS1262 bridge front end + stable excitation + shunt cal

Pt100 at contact point
  | 4-wire shielded cable
  +-- I+, S+, S-, I-
  |
Local precision resistance measurement

Joint displacement sensor
  | selected LVDT conditioner or isolated 4-20 mA transmitter
  +-- protected field cable
  |
Local isolated receiver -> ADC
```

## 4. Esquema de plan de colocación paramétrico

```text
Longitudinal axis (X) ---------------------------------------------------->

       support S0                support S1                support S2
          |-------------------------|-------------------------|
                 L1                           L2
             SD-1-Q1     SD-1-M      SD-1-Q3  SD-2-Q1 ... SD-2-M ...
             x=L1/4      x=L1/2      x=3L1/4
                  SD-1-M-T (optional second girder at midspan)

Across section at a selected midspan (Y):

 girder 1        girder 2        girder 3        girder n
    |---------------|---------------|---------------|
                SD-1-M         SD-1-M-T

X = bridge longitudinal, Y = transverse, Z = vertical.
Locations and girder numbers are placeholders until verified drawings/model.
```

## 5. Diagrama de puesta en marcha

```text
Survey/record drawings
        |
Model and modal observability review
        |
Pilot layout approval ----> access, safety and attachment method
        |
Bench tests: noise / rate / PPS / storage / power
        |
Install sensor and independent enclosure
        |
Power and check channels/time/health
        |
Controlled excitation / reference comparison
        |
Acceptance record + config hash + coordinates + photos
        |
Baseline campaign --> conditioned analysis --> inspection workflow
```

No usar el resultado del dashboard o de una prueba de conectividad como aceptación estructural del montaje.
