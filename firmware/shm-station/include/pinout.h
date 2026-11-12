/*
 * pinout.h - GENERADO por src/shm/firmware-pinout.ts. NO EDITAR A MANO.
 * Para regenerarlo: UPDATE_PINOUT=1 npx vitest run src/shm/firmware-pinout.test.ts
 *
 * STM32H743VIT6 (LQFP100). Pinout del diseño de ingenierías con la corrección
 * SPI1 (RV-01/RV-04) y la propuesta técnica SIN FIRMAR para los GPIO libres.
 * MODE: 0 entrada, 1 salida, 2 función alternativa.
 */
#ifndef SHM_PINOUT_H
#define SHM_PINOUT_H

/* ACC_SCK: PB3, patilla 89, SPI1_SCK AF5 [corregido] */
#define PIN_ACC_SCK_PORT  GPIOB
#define PIN_ACC_SCK_PIN   3u
#define PIN_ACC_SCK_MODE  2u
#define PIN_ACC_SCK_AF    5u

/* ACC_MISO: PB4, patilla 90, SPI1_MISO AF5 [corregido] */
#define PIN_ACC_MISO_PORT  GPIOB
#define PIN_ACC_MISO_PIN   4u
#define PIN_ACC_MISO_MODE  2u
#define PIN_ACC_MISO_AF    5u

/* ACC_MOSI: PB5, patilla 91, SPI1_MOSI AF5 [corregido] */
#define PIN_ACC_MOSI_PORT  GPIOB
#define PIN_ACC_MOSI_PIN   5u
#define PIN_ACC_MOSI_MODE  2u
#define PIN_ACC_MOSI_AF    5u

/* ACC_CS_N: PA4, patilla 28, GPIO [diseño] */
#define PIN_ACC_CS_N_PORT  GPIOA
#define PIN_ACC_CS_N_PIN   4u
#define PIN_ACC_CS_N_MODE  1u
#define PIN_ACC_CS_N_AF    0u

/* TILT_CS_N: PB0, patilla 34, GPIO [diseño] */
#define PIN_TILT_CS_N_PORT  GPIOB
#define PIN_TILT_CS_N_PIN   0u
#define PIN_TILT_CS_N_MODE  1u
#define PIN_TILT_CS_N_AF    0u

/* ADC_CS_N: PB1, patilla 35, GPIO [diseño] */
#define PIN_ADC_CS_N_PORT  GPIOB
#define PIN_ADC_CS_N_PIN   1u
#define PIN_ADC_CS_N_MODE  1u
#define PIN_ADC_CS_N_AF    0u

/* ADC_DRDY_N: PE2, patilla 1, GPIO/EXTI [diseño] */
#define PIN_ADC_DRDY_N_PORT  GPIOE
#define PIN_ADC_DRDY_N_PIN   2u
#define PIN_ADC_DRDY_N_MODE  0u
#define PIN_ADC_DRDY_N_AF    0u

/* GNSS_TX: PA9, patilla 68, USART1_TX AF7 [diseño] */
#define PIN_GNSS_TX_PORT  GPIOA
#define PIN_GNSS_TX_PIN   9u
#define PIN_GNSS_TX_MODE  2u
#define PIN_GNSS_TX_AF    7u

/* GNSS_RX: PA10, patilla 69, USART1_RX AF7 [diseño] */
#define PIN_GNSS_RX_PORT  GPIOA
#define PIN_GNSS_RX_PIN   10u
#define PIN_GNSS_RX_MODE  2u
#define PIN_GNSS_RX_AF    7u

/* GNSS_PPS: PA0, patilla 22, TIM2_CH1 AF1 [diseño] */
#define PIN_GNSS_PPS_PORT  GPIOA
#define PIN_GNSS_PPS_PIN   0u
#define PIN_GNSS_PPS_MODE  2u
#define PIN_GNSS_PPS_AF    1u

/* SDMMC_D0: PC8, patilla 65, SDMMC1_D0 AF12 [diseño] */
#define PIN_SDMMC_D0_PORT  GPIOC
#define PIN_SDMMC_D0_PIN   8u
#define PIN_SDMMC_D0_MODE  2u
#define PIN_SDMMC_D0_AF    12u

/* SDMMC_D1: PC9, patilla 66, SDMMC1_D1 AF12 [diseño] */
#define PIN_SDMMC_D1_PORT  GPIOC
#define PIN_SDMMC_D1_PIN   9u
#define PIN_SDMMC_D1_MODE  2u
#define PIN_SDMMC_D1_AF    12u

/* SDMMC_D2: PC10, patilla 78, SDMMC1_D2 AF12 [diseño] */
#define PIN_SDMMC_D2_PORT  GPIOC
#define PIN_SDMMC_D2_PIN   10u
#define PIN_SDMMC_D2_MODE  2u
#define PIN_SDMMC_D2_AF    12u

/* SDMMC_D3: PC11, patilla 79, SDMMC1_D3 AF12 [diseño] */
#define PIN_SDMMC_D3_PORT  GPIOC
#define PIN_SDMMC_D3_PIN   11u
#define PIN_SDMMC_D3_MODE  2u
#define PIN_SDMMC_D3_AF    12u

/* SDMMC_CK: PC12, patilla 80, SDMMC1_CK AF12 [diseño] */
#define PIN_SDMMC_CK_PORT  GPIOC
#define PIN_SDMMC_CK_PIN   12u
#define PIN_SDMMC_CK_MODE  2u
#define PIN_SDMMC_CK_AF    12u

/* SDMMC_CMD: PD2, patilla 83, SDMMC1_CMD AF12 [diseño] */
#define PIN_SDMMC_CMD_PORT  GPIOD
#define PIN_SDMMC_CMD_PIN   2u
#define PIN_SDMMC_CMD_MODE  2u
#define PIN_SDMMC_CMD_AF    12u

/* ADC_RESET_N: PE3, patilla 2, GPIO [diseño] */
#define PIN_ADC_RESET_N_PORT  GPIOE
#define PIN_ADC_RESET_N_PIN   3u
#define PIN_ADC_RESET_N_MODE  1u
#define PIN_ADC_RESET_N_AF    0u

/* SENSOR_SYNC: PA3, patilla 25, TIM2_CH4 AF1 [propuesta] */
#define PIN_SENSOR_SYNC_PORT  GPIOA
#define PIN_SENSOR_SYNC_PIN   3u
#define PIN_SENSOR_SYNC_MODE  2u
#define PIN_SENSOR_SYNC_AF    1u

/* WDG_KICK: PE4, patilla 3, GPIO [propuesta] */
#define PIN_WDG_KICK_PORT  GPIOE
#define PIN_WDG_KICK_PIN   4u
#define PIN_WDG_KICK_MODE  1u
#define PIN_WDG_KICK_AF    0u

/* PWR_GOOD: PD7, patilla 88, GPIO/EXTI7 [propuesta] */
#define PIN_PWR_GOOD_PORT  GPIOD
#define PIN_PWR_GOOD_PIN   7u
#define PIN_PWR_GOOD_MODE  0u
#define PIN_PWR_GOOD_AF    0u

/* ACC_INT1: PD4, patilla 85, GPIO/EXTI4 [propuesta] */
#define PIN_ACC_INT1_PORT  GPIOD
#define PIN_ACC_INT1_PIN   4u
#define PIN_ACC_INT1_MODE  0u
#define PIN_ACC_INT1_AF    0u

/* ACC_INT2: PD5, patilla 86, GPIO/EXTI5 [propuesta] */
#define PIN_ACC_INT2_PORT  GPIOD
#define PIN_ACC_INT2_PIN   5u
#define PIN_ACC_INT2_MODE  0u
#define PIN_ACC_INT2_AF    0u

/* TILT_INT: PD6, patilla 87, GPIO/EXTI6 [propuesta] */
#define PIN_TILT_INT_PORT  GPIOD
#define PIN_TILT_INT_PIN   6u
#define PIN_TILT_INT_MODE  0u
#define PIN_TILT_INT_AF    0u

/* ETH_PHY_RST_N: PE5, patilla 4, GPIO [propuesta] */
#define PIN_ETH_PHY_RST_N_PORT  GPIOE
#define PIN_ETH_PHY_RST_N_PIN   5u
#define PIN_ETH_PHY_RST_N_MODE  1u
#define PIN_ETH_PHY_RST_N_AF    0u

/* LORA_RST_N: PE6, patilla 5, GPIO [propuesta] */
#define PIN_LORA_RST_N_PORT  GPIOE
#define PIN_LORA_RST_N_PIN   6u
#define PIN_LORA_RST_N_MODE  1u
#define PIN_LORA_RST_N_AF    0u

/* RS485_TX: PD8, patilla 55, USART3_TX AF7 [propuesta] */
#define PIN_RS485_TX_PORT  GPIOD
#define PIN_RS485_TX_PIN   8u
#define PIN_RS485_TX_MODE  2u
#define PIN_RS485_TX_AF    7u

/* RS485_RX: PD9, patilla 56, USART3_RX AF7 [propuesta] */
#define PIN_RS485_RX_PORT  GPIOD
#define PIN_RS485_RX_PIN   9u
#define PIN_RS485_RX_MODE  2u
#define PIN_RS485_RX_AF    7u

/* RS485_DE: PD12, patilla 59, USART3_RTS/DE AF7 [propuesta] */
#define PIN_RS485_DE_PORT  GPIOD
#define PIN_RS485_DE_PIN   12u
#define PIN_RS485_DE_MODE  2u
#define PIN_RS485_DE_AF    7u

/* LORA_TX: PE8, patilla 38, UART7_TX AF7 [propuesta] */
#define PIN_LORA_TX_PORT  GPIOE
#define PIN_LORA_TX_PIN   8u
#define PIN_LORA_TX_MODE  2u
#define PIN_LORA_TX_AF    7u

/* LORA_RX: PE7, patilla 37, UART7_RX AF7 [propuesta] */
#define PIN_LORA_RX_PORT  GPIOE
#define PIN_LORA_RX_PIN   7u
#define PIN_LORA_RX_MODE  2u
#define PIN_LORA_RX_AF    7u

/* Ethernet RMII: todos en AF11 (DS12110 Rev 11). */
#define PIN_ETH_RMII_REF_CLK_PORT  GPIOA
#define PIN_ETH_RMII_REF_CLK_PIN   1u
#define PIN_ETH_RMII_REF_CLK_AF    11u
#define PIN_ETH_MDIO_PORT  GPIOA
#define PIN_ETH_MDIO_PIN   2u
#define PIN_ETH_MDIO_AF    11u
#define PIN_ETH_RMII_CRS_DV_PORT  GPIOA
#define PIN_ETH_RMII_CRS_DV_PIN   7u
#define PIN_ETH_RMII_CRS_DV_AF    11u
#define PIN_ETH_RMII_TX_EN_PORT  GPIOB
#define PIN_ETH_RMII_TX_EN_PIN   11u
#define PIN_ETH_RMII_TX_EN_AF    11u
#define PIN_ETH_RMII_TXD0_PORT  GPIOB
#define PIN_ETH_RMII_TXD0_PIN   12u
#define PIN_ETH_RMII_TXD0_AF    11u
#define PIN_ETH_RMII_TXD1_PORT  GPIOB
#define PIN_ETH_RMII_TXD1_PIN   13u
#define PIN_ETH_RMII_TXD1_AF    11u
#define PIN_ETH_MDC_PORT  GPIOC
#define PIN_ETH_MDC_PIN   1u
#define PIN_ETH_MDC_AF    11u
#define PIN_ETH_RMII_RXD0_PORT  GPIOC
#define PIN_ETH_RMII_RXD0_PIN   4u
#define PIN_ETH_RMII_RXD0_AF    11u
#define PIN_ETH_RMII_RXD1_PORT  GPIOC
#define PIN_ETH_RMII_RXD1_PIN   5u
#define PIN_ETH_RMII_RXD1_AF    11u

/* Depuración: solo SWD (PA13 SWDIO, PA14 SWCLK). Sin JTAG ni SWO: PB3/PB4 quedan libres para SPI1. */
#define SHM_DEBUG_JTAG  0
#define SHM_DEBUG_SWO   0

#endif /* SHM_PINOUT_H */
