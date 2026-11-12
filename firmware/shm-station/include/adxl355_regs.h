/*
 * adxl355_regs.h - Mapa de registros del ADXL355.
 *
 * *** NO VERIFICADO ***
 * Estos valores se escribieron sin tener delante la hoja de datos de Analog
 * Devices (analog.com no permite la descarga automática desde este equipo).
 * El modelo de Renode (renode/ADXL355_SHM.cs) usa LOS MISMOS valores, así que
 * la emulación comprueba la lógica del firmware, no el mapa de registros.
 *
 * Antes de compilar para la placa real hay que cotejar cada línea con la hoja
 * de datos y poner ADXL355_REGS_VERIFIED a 1, anotando la revisión usada.
 */
#ifndef ADXL355_REGS_H
#define ADXL355_REGS_H

#define ADXL355_REGS_VERIFIED 0
#define ADXL355_DATASHEET_REV "sin cotejar"

#if defined(TARGET_HW) && !ADXL355_REGS_VERIFIED
#error "Mapa de registros del ADXL355 sin cotejar con la hoja de datos: no se compila para hardware."
#endif

/* Identificación */
#define ADXL355_REG_DEVID_AD   0x00u
#define ADXL355_REG_DEVID_MST  0x01u
#define ADXL355_REG_PARTID     0x02u
#define ADXL355_DEVID_AD       0xADu
#define ADXL355_DEVID_MST      0x1Du
#define ADXL355_PARTID         0xEDu

/* Estado y datos: 20 bits en complemento a dos, alineados a la izquierda en 3 bytes */
#define ADXL355_REG_STATUS     0x04u
#define ADXL355_STATUS_DATA_RDY 0x01u  /* bit 0 */
#define ADXL355_REG_XDATA3     0x08u   /* X3 X2 X1 Y3 Y2 Y1 Z3 Z2 Z1 consecutivos */

/* Configuración */
#define ADXL355_REG_FILTER     0x28u   /* ODR_LPF en bits 3:0 */
#define ADXL355_ODR_500HZ      0x03u
#define ADXL355_REG_RANGE      0x2Cu   /* bits 1:0: 1 = ±2 g, 2 = ±4 g, 3 = ±8 g */
#define ADXL355_REG_POWER_CTL  0x2Du   /* bit 0 = STANDBY */
#define ADXL355_REG_RESET      0x2Fu
#define ADXL355_RESET_CODE     0x52u

/* SPI modo 0. Byte de comando: (registro << 1) | 1 para leer, | 0 para escribir. */
#define ADXL355_CMD_READ(reg)  ((uint8_t)(((reg) << 1) | 1u))
#define ADXL355_CMD_WRITE(reg) ((uint8_t)((reg) << 1))

/* Sensibilidad típica, LSB por g, según el rango. */
#define ADXL355_LSB_PER_G_2G   256000
#define ADXL355_LSB_PER_G_4G   128000
#define ADXL355_LSB_PER_G_8G    64000

#endif /* ADXL355_REGS_H */
