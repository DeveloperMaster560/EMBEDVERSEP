# Firmware de la estación SHM (STM32H743VIT6) — esqueleto

Estación dinámica SD del Viaducto de La Novena. Escrito a nivel de registros con
los encabezados CMSIS de ST (sin HAL), para que sea pequeño y corra igual en
Renode y en la placa.

| Hace | Pendiente (espera definición de ingenierías) |
|---|---|
| Identifica el ADXL355 y lo lee por SPI1 (PB3/PB4/PB5, AF5) a 200 Hz | Filtro antialias/decimación (`FILTER_ID = sin-filtro-pendiente`) |
| Ventanas con CRC-32, huecos como NaN (nunca 0) | Rango definitivo del ADXL355 (provisional ±2 g) |
| Hora UTC desde la trama RMC del GNSS (USART1) + PPS en PA0 | Captura fina del PPS con TIM2_CH1 (objetivo 100 µs) |
| Estados de calidad: SENSOR_FAULT, DATA_GAP, SATURATED, TIME_HOLDOVER, TIME_INVALID, STORAGE_FAULT | microSD (SDMMC1 + FAT): hoy se declara STORAGE_FAULT |
| Registro JSON por el puerto de servicio (USART3) | Ethernet al gateway: falta el protocolo |
| Watchdog IWDG1 + pulso en WDG_KICK | Modelo del watchdog externo; SCL3300, ADS1262, LoRa; PLL con HSE |

**El mapa de registros del ADXL355 (`include/adxl355_regs.h`) NO está cotejado
con la hoja de datos.** `make TARGET_HW=1` se niega a compilar hasta que lo esté.

`include/pinout.h` se genera desde `src/shm/firmware-pinout.ts`, el mismo dato
que dibuja el circuito en la app; una prueba falla si difieren.

## Estructura

- `src/app.c`: la lógica de la estación, sin registros del MCU. La comparten:
  - `src/main.c` + `src/board.c`: el STM32H743 real (o Renode);
  - `src/sim_main.c` + `src/board_host.c`: el ordenador, con una placa
    SIMULADA (modelo del ADXL355, GNSS y PPS). Ejecuta el código del firmware,
    no emula el chip.

## Compilar y probar

```sh
make host-test          # station.c en el ordenador (7 escenarios)
make sim                # el firmware entero en el ordenador -> build/shm-sim
./build/shm-sim renode/feeds/sd-v2-m.csv --seconds 60 --fault sensor@15-25 --fault pps@32-45 --fault impacto@52
make model-test         # el modelo del ADXL355 de Renode, con Mono y sin Renode
make                    # build/shm-station.elf (necesita .tools/arm-gnu-toolchain)
```

Fallo encontrado así y corregido: con el sensor fuera del bus, el SPI lee ceros
y el firmware los guardaba como medida. Ahora exige DATA_RDY en cada muestra y
comprueba la identidad del sensor una vez por segundo.

`npx vitest run src/shm/firmware-host.test.ts` compila la lógica en C y pasa sus
registros por el contrato de datos de la plataforma.

## Renode

`renode/shm-station.repl` añade SPI1 (la descripción de Renode solo trae SPI4)
y el modelo `ADXL355_SHM.cs`. La señal del sensor es `renode/feeds/sd-v2-m.csv`,
sacada del gemelo funcional: **vibración sintética, no medida**.

La app arranca Renode desde la pestaña Sistema embebido (`server/renodeBridge.ts`),
avanza el chip segundo a segundo y le entrega la trama RMC y el PPS.
