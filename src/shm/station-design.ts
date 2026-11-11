/**
 * Diseño de la estación SHM del Viaducto de la Novena, tal como lo entregó el
 * área de ingenierías el 11/11/2026.
 *
 * Fuente: `Planos/Diseno_SHM_Viaducto_Novena/` (copia literal del paquete).
 * Cada dato lleva la sección de la que sale en `source`. Este archivo NO
 * mejora el diseño ni completa huecos: lo que el documento deja abierto
 * («GPIO libre», «modelo a seleccionar») sigue abierto aquí.
 *
 * Lo único que añade este archivo son los HALLAZGOS DE REVISIÓN de
 * `REVIEW_FINDINGS`, separados del diseño y marcados como pendientes de
 * verificar contra la documentación del fabricante. No modifican el pinout.
 */

const DT = 'diseno_tecnico.md';
const IC = 'interfaces_y_conexiones.md';
const BOM = 'bom_preliminar.csv';

/* ------------------------------------------------------------------------ */
/* Componentes                                                              */
/* ------------------------------------------------------------------------ */

export type DesignStatus =
  | 'seleccionado-preliminar'
  | 'candidato'
  | 'requisito'
  | 'opcional'
  | 'no-seleccionado';

export interface ShmComponent {
  id: string;
  role: string;
  manufacturer: string | null;
  partNumber: string | null;
  status: DesignStatus;
  /** Tensión de alimentación admitida, solo si el documento la da. */
  supplyV: { min: number; max: number } | null;
  interface: string;
  /** Lo que el documento advierte que NO hace o que falta verificar. */
  limits: string;
  source: string;
}

export const SHM_COMPONENTS: ShmComponent[] = [
  {
    id: 'ACC-01', role: 'Acelerómetro triaxial de bajo ruido',
    manufacturer: 'Analog Devices', partNumber: 'ADXL355BCCZ',
    status: 'seleccionado-preliminar', supplyV: { min: 3.3, max: 3.3 }, interface: 'SPI',
    limits: 'No es acelerómetro metrológico certificado. Confirmar sufijo y hoja de datos vigente; el diseño no pudo descargarla.',
    source: `${DT} §5; ${BOM} ACC-01; ${IC} §3.1`,
  },
  {
    id: 'TILT-01', role: 'Inclinómetro de 3 ejes',
    manufacturer: 'Murata', partNumber: 'SCL3300-D01',
    status: 'candidato', supplyV: { min: 3.0, max: 3.6 }, interface: 'SPI',
    limits: 'Solo en estaciones con objetivo de rotación lenta; no reemplaza al acelerómetro.',
    source: `${DT} §5; ${BOM} TILT-01; ${IC} §3.2`,
  },
  {
    id: 'ADC-01', role: 'ADC delta-sigma de precisión para galgas y RTD',
    manufacturer: 'Texas Instruments', partNumber: 'ADS1262',
    status: 'candidato', supplyV: null, interface: 'SPI',
    limits: '32 bits nominales no son 32 bits efectivos. No conectar un puente sin excitación, filtro y referencia diseñados.',
    source: `${DT} §5; ${BOM} ADC-01; ${IC} §3.3`,
  },
  {
    id: 'CTRL-01', role: 'Microcontrolador de la estación',
    manufacturer: 'STMicroelectronics', partNumber: 'STM32H743VIT6',
    status: 'seleccionado-preliminar', supplyV: null, interface: 'SPI, SDMMC, UART, RMII, timers',
    limits: 'PCB propia. El multiplexado de pines está sin verificar contra el datasheet (el diseño no pudo descargarlo).',
    source: `${DT} §5; ${BOM} CTRL-01; ${IC} §2`,
  },
  {
    id: 'RTD-01', role: 'Pt100 IEC 60751 clase A, 4 hilos',
    manufacturer: null, partNumber: null,
    status: 'requisito', supplyV: null, interface: 'Medida de resistencia a 4 hilos',
    limits: 'Seleccionada la clase, no el modelo. Una sonda superficial no da el gradiente de la sección.',
    source: `${DT} §5; ${BOM} RTD-01; ${IC} §3.4`,
  },
  {
    id: 'TIME-01', role: 'Receptor GNSS con PPS y UART',
    manufacturer: null, partNumber: null,
    status: 'requisito', supplyV: null, interface: 'UART + PPS',
    limits: 'Modelo sin seleccionar. Bajo el tablero puede no recibir satélites.',
    source: `${DT} §5; ${BOM} TIME-01`,
  },
  {
    id: 'DISP-01', role: 'Transductor de desplazamiento de junta (LVDT o 4–20 mA)',
    manufacturer: null, partNumber: null,
    status: 'no-seleccionado', supplyV: null, interface: 'Lazo 4–20 mA o acondicionador LVDT',
    limits: 'Sin carrera ni modelo hasta medir el movimiento real de la junta.',
    source: `${DT} §5; ${BOM} DISP-01; ${IC} §3.5`,
  },
  {
    id: 'STOR-01', role: 'microSD industrial o eMMC',
    manufacturer: null, partNumber: null,
    status: 'requisito', supplyV: null, interface: 'SDMMC',
    limits: 'Capacidad mínima: retención calculada más margen de sistema de archivos.',
    source: `${DT} §5, §10; ${BOM} STOR-01`,
  },
];

/* ------------------------------------------------------------------------ */
/* Mapa lógico del MCU (interfaces §2)                                      */
/* ------------------------------------------------------------------------ */

export interface McuSignal {
  signal: string;
  /** GPIO de referencia. `null` cuando el documento dice «GPIO libre». */
  gpio: string | null;
  fn: string;
  direction: 'salida' | 'entrada' | 'bidireccional';
  /** Cuando el pin difiere del documento original, quién y por qué lo cambió. */
  changedFrom?: string;
}

const CAMBIO_SPI1 = 'Decisión de ingenierías del 11/11/2026 por RV-01/RV-04: el bus pasa de SPI2 (PB13/PB14/PB15) a SPI1';

export const MCU_SIGNALS: McuSignal[] = [
  { signal: 'ACC_SCK', gpio: 'PB3', fn: 'SPI1_SCK AF5', direction: 'salida', changedFrom: `PB13 (SPI2_SCK). ${CAMBIO_SPI1}` },
  { signal: 'ACC_MISO', gpio: 'PB4', fn: 'SPI1_MISO AF5', direction: 'entrada', changedFrom: `PB14 (SPI2_MISO). ${CAMBIO_SPI1}` },
  { signal: 'ACC_MOSI', gpio: 'PB5', fn: 'SPI1_MOSI AF5', direction: 'salida', changedFrom: `PB15 (SPI2_MOSI). ${CAMBIO_SPI1}` },
  { signal: 'ACC_CS_N', gpio: 'PA4', fn: 'GPIO', direction: 'salida' },
  { signal: 'TILT_CS_N', gpio: 'PB0', fn: 'GPIO', direction: 'salida' },
  { signal: 'ADC_CS_N', gpio: 'PB1', fn: 'GPIO', direction: 'salida' },
  { signal: 'ADC_DRDY_N', gpio: 'PE2', fn: 'GPIO/EXTI', direction: 'entrada' },
  { signal: 'GNSS_TX', gpio: 'PA9', fn: 'USART1_TX AF7', direction: 'salida' },
  { signal: 'GNSS_RX', gpio: 'PA10', fn: 'USART1_RX AF7', direction: 'entrada' },
  { signal: 'GNSS_PPS', gpio: 'PA0', fn: 'TIM2_CH1 AF1', direction: 'entrada' },
  { signal: 'SDMMC_D0', gpio: 'PC8', fn: 'SDMMC1_D0 AF12', direction: 'bidireccional' },
  { signal: 'SDMMC_D1', gpio: 'PC9', fn: 'SDMMC1_D1 AF12', direction: 'bidireccional' },
  { signal: 'SDMMC_D2', gpio: 'PC10', fn: 'SDMMC1_D2 AF12', direction: 'bidireccional' },
  { signal: 'SDMMC_D3', gpio: 'PC11', fn: 'SDMMC1_D3 AF12', direction: 'bidireccional' },
  { signal: 'SDMMC_CK', gpio: 'PC12', fn: 'SDMMC1_CK AF12', direction: 'salida' },
  { signal: 'SDMMC_CMD', gpio: 'PD2', fn: 'SDMMC1_CMD AF12', direction: 'bidireccional' },
  { signal: 'ADC_RESET_N', gpio: 'PE3', fn: 'GPIO', direction: 'salida' },
  { signal: 'SENSOR_SYNC', gpio: null, fn: 'GPIO/timer', direction: 'salida' },
  { signal: 'WDG_KICK', gpio: null, fn: 'GPIO', direction: 'salida' },
  { signal: 'PWR_GOOD', gpio: null, fn: 'GPIO/EXTI', direction: 'entrada' },
];

/**
 * Depuración. Al usar PB3 (JTDO/TRACESWO) y PB4 (NJTRST) para el SPI se
 * renuncia al JTAG y a la traza SWO; ingenierías lo aceptó el 11/11/2026.
 * Queda SWD en PA13 (SWDIO) y PA14 (SWCLK), que no deben usarse para nada más.
 */
export const DEBUG_INTERFACE = {
  swd: { swdio: 'PA13', swclk: 'PA14' },
  jtag: false,
  swo: false,
  source: 'DS12110 Rev 11, tabla 9; decisión de ingenierías del 11/11/2026',
} as const;

/* ------------------------------------------------------------------------ */
/* Conectores de estación (interfaces §3)                                   */
/* ------------------------------------------------------------------------ */

export interface ConnectorPin {
  pin: number | string;
  signal: string;
  /** Tensión nominal si el documento la fija; `null` si depende del diseño. */
  volts: number | null;
}

export interface StationConnector {
  id: string;
  serves: string;
  pins: ConnectorPin[];
  source: string;
}

export const STATION_CONNECTORS: StationConnector[] = [
  {
    id: 'J1', serves: 'ADXL355 (SPI)', source: `${IC} §3.1`,
    pins: [
      { pin: 1, signal: '+3V3_A', volts: 3.3 }, { pin: 2, signal: 'ACC_SCK', volts: 3.3 },
      { pin: 3, signal: 'ACC_MISO', volts: 3.3 }, { pin: 4, signal: 'ACC_MOSI', volts: 3.3 },
      { pin: 5, signal: 'ACC_CS_N', volts: 3.3 }, { pin: 6, signal: 'DGND', volts: 0 },
      { pin: 7, signal: 'INT1', volts: 3.3 }, { pin: 8, signal: 'INT2', volts: 3.3 },
    ],
  },
  {
    id: 'J2', serves: 'SCL3300-D01 (SPI compartido)', source: `${IC} §3.2`,
    pins: [
      { pin: 1, signal: '+3V3_S', volts: 3.3 }, { pin: 2, signal: 'ACC_SCK', volts: 3.3 },
      { pin: 3, signal: 'ACC_MISO', volts: 3.3 }, { pin: 4, signal: 'ACC_MOSI', volts: 3.3 },
      { pin: 5, signal: 'TILT_CS_N', volts: 3.3 }, { pin: 6, signal: 'DGND', volts: 0 },
      { pin: 7, signal: 'DRDY/INT', volts: 3.3 }, { pin: 8, signal: 'NC/ID', volts: null },
    ],
  },
  {
    id: 'J3', serves: 'Puente de galgas, 6 hilos (ADS1262)', source: `${IC} §3.3`,
    pins: [
      { pin: 1, signal: 'EXC+', volts: null }, { pin: 2, signal: 'EXC-', volts: null },
      { pin: 3, signal: 'SIG+', volts: null }, { pin: 4, signal: 'SIG-', volts: null },
      { pin: 5, signal: 'SENSE+', volts: null }, { pin: 6, signal: 'SENSE-', volts: null },
      { pin: 7, signal: 'SHIELD', volts: null }, { pin: 8, signal: 'NC/ID', volts: null },
    ],
  },
  {
    id: 'J4', serves: 'Pt100 a 4 hilos', source: `${IC} §3.4`,
    pins: [
      { pin: 1, signal: 'I+', volts: null }, { pin: 2, signal: 'S+', volts: null },
      { pin: 3, signal: 'S-', volts: null }, { pin: 4, signal: 'I-', volts: null },
      { pin: 5, signal: 'SHIELD', volts: null },
    ],
  },
  {
    id: 'J5', serves: 'Transductor 4–20 mA (opción)', source: `${IC} §3.5`,
    pins: [
      { pin: 1, signal: '+24V_LOOP', volts: 24 }, { pin: 2, signal: 'LOOP_RETURN', volts: null },
      { pin: 3, signal: 'SHIELD', volts: null }, { pin: 4, signal: 'NC', volts: null },
    ],
  },
  {
    id: 'J6', serves: 'Entrada de alimentación', source: `${IC} §3.6`,
    pins: [
      { pin: 1, signal: 'VIN+', volts: null }, { pin: 2, signal: 'VIN-/RTN', volts: 0 },
      { pin: 3, signal: 'PE/CHASSIS', volts: null }, { pin: 4, signal: 'PWR_GOOD', volts: null },
    ],
  },
];

/** Dispositivos que el documento prohíbe alimentar o excitar a 5 V (§1). */
export const NO_5V_SIGNAL_PREFIXES = ['ACC_', 'TILT_', '+3V3'];

/* ------------------------------------------------------------------------ */
/* Estaciones y reglas de colocación (diseño §4)                            */
/* ------------------------------------------------------------------------ */

export type StationKind = 'SD' | 'SS' | 'SR' | 'GW';

export const STATION_KINDS: Record<StationKind, string> = {
  SD: 'Estación dinámica de tablero: ADXL355 + STM32H743 + almacenamiento local + GNSS-PPS/RTC',
  SS: 'Estación cuasiestática: temperatura (Pt100) y, solo si se justifica, inclinómetro, galgas o desplazamiento',
  SR: 'Referencia de tiempo/ambiental: antena GNSS en cielo despejado',
  GW: 'Gateway/backhaul: Ethernet/LTE para archivos; LoRaWAN solo para estado',
};

/** Fracciones de la luz donde va una estación dinámica (§4.2). */
export const SD_SPAN_FRACTIONS = [0.25, 0.5, 0.75] as const;

/* ------------------------------------------------------------------------ */
/* Adquisición y dimensionado (diseño §3.1, §8, §10)                        */
/* ------------------------------------------------------------------------ */

export const ACQUISITION = {
  /** Base de diseño, a revisar tras el análisis modal (§3.1). */
  analysisBandHz: [0.1, 40] as const,
  sampleRateHz: 200,
  sensorOdrMinHz: 500,
  axes: 3,
  bytesPerSample: 4,
  headerFactor: 2.0,
  retentionDays: 7,
  preEventS: 30,
  postEventS: 120,
  /** Objetivo, no rendimiento garantizado (§10). */
  syncErrorTargetUs: 100,
  syncBandHz: 50,
  source: `${DT} §3.1, §10`,
};

/** Bytes por día de señal cruda: canales × muestras/s × bytes × 86400 × cabecera (§10). */
export function rawBytesPerDay(
  axes = ACQUISITION.axes,
  rateHz = ACQUISITION.sampleRateHz,
  bytes = ACQUISITION.bytesPerSample,
  header = ACQUISITION.headerFactor,
): number {
  return axes * rateHz * bytes * 86400 * header;
}

/** Desfase en grados que produce un error de tiempo a una frecuencia. */
export function phaseErrorDeg(errorUs: number, freqHz: number): number {
  return 360 * freqHz * errorUs * 1e-6;
}

/** Envolvente solar ILUSTRATIVA del §8.2; no es una selección de compra. */
export const SOLAR_EXAMPLE = {
  averagePowerW: 5,
  autonomyDays: 3,
  conversionEff: 0.85,
  usableDoD: 0.8,
  tempAgingFactor: 0.9,
  batteryV: 25.6,
  peakSunHours: 3.5,
  performanceRatio: 0.65,
  source: `${DT} §8.2`,
};

export function solarSizing(s = SOLAR_EXAMPLE) {
  const dailyWh = s.averagePowerW * 24;
  const derate = s.conversionEff * s.usableDoD * s.tempAgingFactor;
  const minBatteryWh = (dailyWh * s.autonomyDays) / derate;
  return {
    dailyWh,
    minBatteryWh,
    minBatteryAh: minBatteryWh / s.batteryV,
    usableWh: (ah: number) => ah * s.batteryV * derate,
    minPanelW: dailyWh / (s.peakSunHours * s.performanceRatio),
  };
}

/* ------------------------------------------------------------------------ */
/* Hallazgos de revisión: NO forman parte del diseño                        */
/* ------------------------------------------------------------------------ */

export interface ReviewFinding {
  id: string;
  severity: 'bloqueante' | 'importante' | 'menor';
  finding: string;
  /** Qué hay que consultar para confirmarlo o descartarlo. */
  verifyWith: string;
  status: 'confirmado' | 'sin-verificar' | 'resuelto';
  /** Cómo se resolvió, cuando ya está resuelto. */
  resolution?: string;
  /** Citas de la documentación que lo confirman, cuando se ha verificado. */
  evidence: string[];
}

const DS = 'ST DS12110 Rev 11 (enero 2026)';

export const REVIEW_FINDINGS: ReviewFinding[] = [
  {
    id: 'RV-01',
    severity: 'bloqueante',
    finding:
      'El documento elige SPI2 en PB13 «para no chocar con RMII Ethernet». Pero el encapsulado elegido, STM32H743VIT6 (LQFP100), no tiene puerto G: ETH_TXD1 solo puede salir por PB13 (la alternativa es PG14). Con Ethernet por RMII, PB13 queda ocupado y choca con ACC_SCK. Lo mismo ocurre con PB11 y PB12 para TX_EN y TXD0. Alternativas de SPI2_SCK a evaluar: PB10 o PD3.',
    verifyWith: 'STM32H743xI datasheet (DS12110), tabla de funciones alternas y pinout LQFP100',
    status: 'resuelto',
    resolution: 'Ingenierías (11/11/2026): el bus de sensores pasa a SPI1 en PB3/PB4/PB5, AF5, y se renuncia a JTAG y SWO. Depuración por SWD (PA13/PA14).',
    evidence: [
      `${DS}, figura 5 (p. 55): el pinout LQFP100 solo tiene PA–PE y PH0/PH1; no hay ningún pin PG.`,
      `${DS}, tabla 9 (p. 75 y 84–85): ETH_MII_TXD1/ETH_RMII_TXD1 está en PB13 (pin 52 del LQFP100), PG12 y PG14; PG12 y PG14 no existen en el LQFP100.`,
      `${DS}, tabla 9: ETH_RMII_TX_EN en PB11 (pin 47) y ETH_RMII_TXD0 en PB12 (pin 51); sus alternativas PG11 y PG13 tampoco existen en el LQFP100.`,
      `${DS}, tabla 10: en PB13, SPI2_SCK es AF5 y ETH_RMII_TXD1 es AF11. Un pin no puede tener dos funciones alternas a la vez.`,
      `${DS}, tablas 9 y 10: PB10 (pin 46) y PD3 (pin 84) ofrecen SPI2_SCK en AF5 y no tienen ninguna función RMII. PB10 solo tiene ETH_MII_RX_ER, que es exclusiva de MII.`,
    ],
  },
  {
    id: 'RV-02',
    severity: 'importante',
    finding:
      'En la NUCLEO-H743ZI2 que el diseño propone para el bring-up, PB0 (TILT_CS_N) llevaría un LED de usuario. Con el bus en SPI1 hay que comprobar además qué hace la placa con PB3, PB4 y PB5 (PB3 es la línea SWO del depurador en muchas Nucleo). El choque con PB13/PB14 ya no aplica tras el cambio a SPI1.',
    verifyWith: 'ST UM2407 (manual de las Nucleo-144 STM32H7 MB1364), tablas de LED y de Ethernet y puentes de soldadura',
    status: 'sin-verificar',
    evidence: [
      'Se recibió la UM2408 Rev 6, que cubre la placa MB1363 (NUCLEO-H745ZI-Q, H755ZI-Q y H7A3ZI-Q), no la NUCLEO-H743ZI2. Hace falta la UM2407.',
    ],
  },
  {
    id: 'RV-03',
    severity: 'menor',
    finding:
      'El ejemplo de contrato de datos fija `range_g: 2` y `time_uncertainty_us: 100`. El propio documento dice que son valores de esquema, no configuración: no deben copiarse al firmware como valores por defecto.',
    verifyWith: `${IC} §6`,
    status: 'confirmado',
    evidence: [`${IC} §6: «Los valores de ejemplo son de esquema, no telemetría real.»`],
  },
  {
    id: 'RV-04',
    severity: 'bloqueante',
    finding:
      'Ingenierías eligió PB3 para ACC_SCK (respuesta a RV-01). PB3 no tiene SPI2_SCK: sus SCK son SPI1 (AF5), SPI3 (AF6) y SPI6 (AF8). El SCK y el MISO/MOSI de un bus tienen que ser del mismo periférico, así que PB3 obliga a cambiar el bus entero. La opción limpia es SPI1 en PB3/PB4/PB5, los tres en AF5. Además, PB3 y PB4 son JTDO/TRACESWO y NJTRST tras el reset: se pierden JTAG y la traza SWO; SWD (PA13/PA14) sigue disponible.',
    verifyWith: 'DS12110 Rev 11, tablas 9 y 10',
    status: 'resuelto',
    resolution: 'Ingenierías (11/11/2026): el bus de sensores pasa a SPI1 en PB3/PB4/PB5, AF5, y se renuncia a JTAG y SWO. Depuración por SWD (PA13/PA14).',
    evidence: [
      `${DS}, tabla 9 (p. 85): PB3 es el pin 89 del LQFP100, con nombre «PB3(JTDO/TRACESWO)» como función tras el reset; funciones: JTDO/TRACESWO, TIM2_CH2, HRTIM_FLT4, SPI1_SCK, SPI3_SCK, SPI6_SCK, SDMMC2_D2, CRS_SYNC, UART7_RX. No hay SPI2_SCK.`,
      `${DS}, tabla 10: PB3 = SPI1_SCK AF5, SPI3_SCK AF6, SPI6_SCK AF8.`,
      `${DS}, tabla 10: PB4 = SPI1_MISO AF5 (NJTRST tras el reset); PB5 = SPI1_MOSI AF5. PB4 y PB5 no los usa ninguna señal del diseño.`,
      `${DS}, tabla 10: con SPI3, MISO/MOSI alternativos son PC11/PC12, que ya ocupa la microSD (SDMMC1), o PB4/PB5 (AF6/AF7) y PD6 (AF5).`,
    ],
  },
];

/**
 * Funciones alternas verificadas en la DS12110 Rev 11, tabla 10, para los
 * pines del diseño. Todas coinciden con lo que declara el documento de
 * interfaces; el problema de RV-01 no es un AF mal puesto, es un pin
 * compartido con Ethernet.
 */
export const VERIFIED_AF: Record<string, { af: number; fn: string }> = {
  PA0: { af: 1, fn: 'TIM2_CH1' },
  PA9: { af: 7, fn: 'USART1_TX' },
  PA10: { af: 7, fn: 'USART1_RX' },
  PB3: { af: 5, fn: 'SPI1_SCK' },
  PB4: { af: 5, fn: 'SPI1_MISO' },
  PB5: { af: 5, fn: 'SPI1_MOSI' },
  PC8: { af: 12, fn: 'SDMMC1_D0' },
  PC9: { af: 12, fn: 'SDMMC1_D1' },
  PC10: { af: 12, fn: 'SDMMC1_D2' },
  PC11: { af: 12, fn: 'SDMMC1_D3' },
  PC12: { af: 12, fn: 'SDMMC1_CK' },
  PD2: { af: 12, fn: 'SDMMC1_CMD' },
};

/**
 * Pines que ocupa una interfaz RMII en el LQFP100, según la DS12110 (tabla 9).
 * En este encapsulado no hay alternativa para ninguno de ellos.
 */
export const RMII_PINS_LQFP100: Record<string, string> = {
  PA1: 'ETH_RMII_REF_CLK',
  PA2: 'ETH_MDIO',
  PA7: 'ETH_RMII_CRS_DV',
  PB11: 'ETH_RMII_TX_EN',
  PB12: 'ETH_RMII_TXD0',
  PB13: 'ETH_RMII_TXD1',
  PC1: 'ETH_MDC',
  PC4: 'ETH_RMII_RXD0',
  PC5: 'ETH_RMII_RXD1',
};

/**
 * Alternativas que se propusieron para RV-01 manteniendo SPI2. Ingenierías
 * las DESCARTÓ y eligió SPI1 en PB3/PB4/PB5; se conservan como registro.
 */
export const PROPOSED_ACC_SCK = [
  { gpio: 'PB10', af: 5, lqfp100Pin: 46, note: 'Junto a PB11/PB12, que con RMII llevan Ethernet: cuidar la diafonía en el ruteo.' },
  { gpio: 'PD3', af: 5, lqfp100Pin: 84, note: 'Comparte pin con FMC_CLK; el diseño no usa el FMC.' },
];

/**
 * Número de patilla en el LQFP100 de cada GPIO que usa el diseño, verificado
 * en la DS12110 Rev 11 (figura 5 y tabla 9).
 */
export const LQFP100_PIN: Record<string, number> = {
  PE2: 1, PE3: 2, PA0: 22, PA4: 28, PB0: 34, PB1: 35,
  PA9: 68, PA10: 69, PA13: 72, PA14: 76,
  PC8: 65, PC9: 66, PC10: 78, PC11: 79, PC12: 80, PD2: 83,
  PB3: 89, PB4: 90, PB5: 91,
};

/**
 * Nombre de cada una de las 100 patillas del LQFP100, en orden (índice 0 =
 * patilla 1). Transcrito de la DS12110 Rev 11, figura 5 (p. 55): lado
 * izquierdo 1–25 de arriba abajo, inferior 26–50, derecho 51–75 de abajo
 * arriba y superior 76–100 de derecha a izquierda.
 */
export const LQFP100_PINOUT: readonly string[] = [
  // 1–25
  'PE2', 'PE3', 'PE4', 'PE5', 'PE6', 'VBAT', 'PC13', 'PC14-OSC32_IN', 'PC15-OSC32_OUT', 'VSS',
  'VDD', 'PH0-OSC_IN', 'PH1-OSC_OUT', 'NRST', 'PC0', 'PC1', 'PC2_C', 'PC3_C', 'VSSA', 'VREF+',
  'VDDA', 'PA0', 'PA1', 'PA2', 'PA3',
  // 26–50
  'VSS', 'VDD', 'PA4', 'PA5', 'PA6', 'PA7', 'PC4', 'PC5', 'PB0', 'PB1',
  'PB2', 'PE7', 'PE8', 'PE9', 'PE10', 'PE11', 'PE12', 'PE13', 'PE14', 'PE15',
  'PB10', 'PB11', 'VCAP', 'VSS', 'VDD',
  // 51–75
  'PB12', 'PB13', 'PB14', 'PB15', 'PD8', 'PD9', 'PD10', 'PD11', 'PD12', 'PD13',
  'PD14', 'PD15', 'PC6', 'PC7', 'PC8', 'PC9', 'PA8', 'PA9', 'PA10', 'PA11',
  'PA12', 'PA13', 'VCAP', 'VSS', 'VDD',
  // 76–100
  'PA14', 'PA15', 'PC10', 'PC11', 'PC12', 'PD0', 'PD1', 'PD2', 'PD3', 'PD4',
  'PD5', 'PD6', 'PD7', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7', 'BOOT0', 'PB8',
  'PB9', 'PE0', 'PE1', 'VSS', 'VDD',
];

/** GPIO de una patilla («PC14-OSC32_IN» → «PC14»); `null` si es de alimentación o control. */
export function gpioOfPin(name: string): string | null {
  const m = /^P[A-K]\d{1,2}/.exec(name);
  return m ? m[0] : null;
}

