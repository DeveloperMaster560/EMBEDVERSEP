# Nota RV-01: conflicto de pines SPI2/RMII en el STM32H743VIT6

**Para:** área de ingenierías · **Asunto:** diseño preliminar SHM del Viaducto de La Novena · **Fecha:** 11/11/2026

En el diseño, el reloj del acelerómetro (ACC_SCK, en PB13) choca con el Ethernet RMII. En el encapsulado LQFP100, PB13 es la única salida posible de ETH_RMII_TXD1. Hay que mover ACC_SCK a **PB10** o a **PD3** antes de diseñar la PCB.

## Evidencia

Fuente: ST, *STM32H742xI/G STM32H743xI/G Datasheet*, **DS12110 Rev 11** (enero de 2026).

| Hecho | Dónde |
|---|---|
| El pinout LQFP100 solo tiene los puertos A–E y PH0/PH1. No hay ningún pin del puerto G. | Figura 5, p. 55 |
| ETH_MII_TXD1/ETH_RMII_TXD1 solo está en PB13 (pin 52 del LQFP100), PG12 y PG14. PG12 y PG14 no existen en el LQFP100. | Tabla 9, p. 75 y 84–85 |
| Lo mismo pasa con ETH_RMII_TX_EN, que solo puede ir en PB11 (pin 47), y con ETH_RMII_TXD0, que solo puede ir en PB12 (pin 51). Sus alternativas, PG11 y PG13, tampoco existen en este encapsulado. | Tabla 9 |
| En PB13, SPI2_SCK es AF5 y ETH_RMII_TXD1 es AF11. Un pin solo tiene una función alterna activa a la vez. | Tabla 10 |

El documento de interfaces dice haber elegido SPI2 para no chocar con el Ethernet, pero en el LQFP100 el choque está justo en ACC_SCK.

Además, el documento solo nombra PA7, PC4 y PC5 como pines del Ethernet. Con RMII en el LQFP100 son nueve, y todos tienen una única ubicación posible en este encapsulado:

| Pin | Función RMII |
|---|---|
| PA1 | ETH_RMII_REF_CLK |
| PA2 | ETH_MDIO |
| PA7 | ETH_RMII_CRS_DV |
| PB11 | ETH_RMII_TX_EN |
| PB12 | ETH_RMII_TXD0 |
| PB13 | ETH_RMII_TXD1 |
| PC1 | ETH_MDC |
| PC4 | ETH_RMII_RXD0 |
| PC5 | ETH_RMII_RXD1 |

## Corrección propuesta: elegir PB10 o PD3

Las dos opciones están verificadas en las tablas 9 y 10. Ambas ofrecen SPI2_SCK en AF5, ninguna tiene función RMII y ninguna la usa otra señal del diseño. MISO (PB14) y MOSI (PB15) no cambian.

| | PB10 | PD3 |
|---|---|---|
| Pin LQFP100 | 46 | 84 |
| Función alterna | SPI2_SCK, AF5 | SPI2_SCK, AF5 |
| Otras funciones del pin | ETH_MII_RX_ER (solo MII, no se usa con RMII), I2C2_SCL, USART3_TX… | FMC_CLK, DCMI_D5, USART2_CTS… |
| A tener en cuenta | Está junto a PB11 y PB12, que llevan Ethernet: cuidar la diafonía en el ruteo. | Está en otro lado del encapsulado, lejos de PB14 y PB15: el bus SPI queda más disperso en la PCB. El diseño no usa el FMC. |

**Decisión que se pide a ingenierías:** cuál de las dos, según el ruteo previsto de la PCB.

## Lo que está bien y lo que queda pendiente

- **Las funciones alternas que declara el diseño son correctas** (tabla 10): PPS en PA0 = TIM2_CH1 (AF1), GNSS en PA9/PA10 = USART1 (AF7), SPI2 en PB13/PB14/PB15 (AF5) y microSD en PC8–PC12 y PD2 = SDMMC1 (AF12). El problema es solo el pin compartido.
- **RV-02 sin verificar.** El diseño propone la NUCLEO-H743ZI2 para el bring-up. Sospechamos que en esa placa PB13 lleva el Ethernet de la propia placa, y PB0 y PB14 los LED de usuario. Para confirmarlo hace falta la **UM2407** (placa MB1364); el manual recibido fue la UM2408, que cubre otras placas (MB1363).
- El pinout del diseño no se ha modificado en el sistema: la corrección la decide ingeniería.

## Seguimiento (11/11/2026): la elección de PB3

Ingenierías eligió **PB3** para ACC_SCK. El motivo es válido: PB3 queda fuera del grupo RMII y lejos de PB11/PB12. Pero **PB3 no tiene SPI2_SCK**, así que no funciona con MISO y MOSI en PB14/PB15 (SPI2).

| Pin | Pin LQFP100 | Funciones SPI (tabla 10) | Tras el reset (tabla 9) |
|---|---|---|---|
| PB3 | 89 | SPI1_SCK AF5 · SPI3_SCK AF6 · SPI6_SCK AF8 | JTDO/TRACESWO |
| PB4 | 90 | SPI1_MISO AF5 · SPI3_MISO AF6 · SPI6_MISO AF8 | NJTRST |
| PB5 | 91 | SPI1_MOSI AF5 · SPI3_MOSI AF7 · SPI6_MOSI AF8 | — |

El reloj, MISO y MOSI de un bus SPI tienen que salir del mismo periférico. Con PB3 hay dos caminos:

1. **Pasar el bus a SPI1 en PB3/PB4/PB5, los tres en AF5.** Es la opción más limpia: ninguno de los tres lo usa el diseño ni el RMII. PB5 tiene además ETH_PPS_OUT (AF11), que no forma parte del RMII y el diseño no usa.
2. **Volver a SPI2 con PB10 o PD3**, como proponía la nota.

Con PB3 y PB4 como SPI se pierden el JTAG de 4/5 hilos y la traza SWO. La depuración por SWD (PA13/PA14) sigue disponible.

Los chip select (PA4, PB0, PB1) no cambian en ningún caso. Queda pendiente que ingenierías confirme cuál de los dos caminos sigue, y si renuncia a JTAG/SWO.

## Decisión final (11/11/2026)

Ingenierías confirmó el **camino 1**: el bus de sensores pasa a **SPI1 en PB3/PB4/PB5** y se renuncia a JTAG y SWO. Pinout resultante del STM32H743VIT6 (LQFP100):

| Señal | GPIO | Pin LQFP100 | Función | Cambio |
|---|---|---|---|---|
| ACC_SCK | PB3 | 89 | SPI1_SCK AF5 | antes PB13 |
| ACC_MISO | PB4 | 90 | SPI1_MISO AF5 | antes PB14 |
| ACC_MOSI | PB5 | 91 | SPI1_MOSI AF5 | antes PB15 |
| ACC_CS_N | PA4 | 28 | GPIO | — |
| TILT_CS_N | PB0 | 34 | GPIO | — |
| ADC_CS_N | PB1 | 35 | GPIO | — |
| ADC_DRDY_N | PE2 | 1 | GPIO/EXTI | — |
| ADC_RESET_N | PE3 | 2 | GPIO | — |
| GNSS_PPS | PA0 | 22 | TIM2_CH1 AF1 | — |
| GNSS_TX | PA9 | 68 | USART1_TX AF7 | — |
| GNSS_RX | PA10 | 69 | USART1_RX AF7 | — |
| SDMMC_D0–D3 | PC8–PC11 | 65–66, 78–79 | SDMMC1 AF12 | — |
| SDMMC_CK | PC12 | 80 | SDMMC1_CK AF12 | — |
| SDMMC_CMD | PD2 | 83 | SDMMC1_CMD AF12 | — |
| SWDIO / SWCLK | PA13 / PA14 | 72 / 76 | depuración SWD | reservados |
| Ethernet RMII | PA1, PA2, PA7, PB11, PB12, PB13, PC1, PC4, PC5 | — | ETH AF11 | reservados |

- Los conectores J1 (ADXL355) y J2 (SCL3300) **no cambian**: llevan las mismas señales en los mismos pines del conector. Solo cambia el ruteo hasta el MCU.
- PB14 y PB15 quedan libres.
- Firmware: hay que inicializar SPI1 en lugar de SPI2 y configurar PB3/PB4/PB5 en AF5. La configuración de reloj del bus se comprueba en el manual de referencia (RM0433), que no se ha revisado.
- Siguen abiertas SENSOR_SYNC, WDG_KICK y PWR_GOOD («GPIO libre» en el documento) y RV-02 (falta la UM2407).

## Propuesta técnica para lo que el diseño dejaba abierto (sin firmar)

Redactada por un asistente de IA (Claude) a petición del usuario el 11/11/2026. **No es una decisión del área de ingenierías.** Un ingeniero responsable debe revisarla y firmarla antes de fabricar. Los pines están verificados en la DS12110 Rev 11 (tablas 9 y 10). Los componentes se eligieron por conocimiento general del mercado y sus hojas de datos no se han revisado.

| Señal | GPIO | Pin | Función |
|---|---|---|---|
| ACC_INT1 / ACC_INT2 (J1-7/8) | PD4 / PD5 | 85 / 86 | EXTI4 / EXTI5 |
| TILT_INT (J2-7, si el carrier lo ofrece) | PD6 | 87 | EXTI6 |
| PWR_GOOD (J6-4, vía aislador) | PD7 | 88 | EXTI7 |
| SENSOR_SYNC | PA3 | 25 | TIM2_CH4 AF1, mismo temporizador que el PPS |
| WDG_KICK | PE4 | 3 | GPIO |
| ETH_PHY_RST_N | PE5 | 4 | GPIO |
| LORA_RST_N | PE6 | 5 | GPIO |
| RS485_TX / RX / DE | PD8 / PD9 / PD12 | 55 / 56 / 59 | USART3 AF7, DE por hardware |
| LORA_TX / RX | PE8 / PE7 | 38 / 37 | UART7 AF7 |

| Componente | Elección | Verificar |
|---|---|---|
| PHY Ethernet | Microchip LAN8742AI-CZ, cristal de 25 MHz, REF_CLK de 50 MHz a PA1 | Modo de reloj, dirección PHY, alimentación |
| Receptor GNSS | u-blox NEO-M8T o equivalente de tiempo con PPS | Estado de producción, niveles lógicos |
| RS-485 | Analog Devices ADM2587E (aislado) | Velocidad, emisiones |
| LoRaWAN | RAKwireless RAK3172 | Plan de frecuencias en Colombia (ANE) |
| LTE | Ninguno en la estación; solo en el gateway si hace falta | Presupuesto de energía |

Conectores: **J7** 1 +5V_GNSS · 2 DGND · 3 GNSS_TX · 4 GNSS_RX · 5 GNSS_PPS · 6 DGND · 7 NC · 8 SHIELD. **J9** 1 A · 2 B · 3 GND_ISO · 4 SHIELD, con 120 Ω por puente. **J10** SMA de LoRa.

Comprobado por `src/shm/engineering-proposal.test.ts`: ningún pin repetido, nada sobre RMII ni SWD, una línea EXTI por interrupción y no más de 3,3 V hacia el MCU.

