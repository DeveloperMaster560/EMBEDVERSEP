/**
 * Propuesta técnica para cerrar lo que el diseño de ingenierías dejó abierto.
 *
 * AUTORÍA: la redactó Claude (asistente de IA) el 11/11/2026, a petición del
 * usuario, que pidió tomar las decisiones pendientes. NO es una decisión del
 * área de ingenierías ni está firmada. Antes de fabricar, un ingeniero
 * responsable debe revisarla y firmarla.
 *
 * Qué está verificado y qué no:
 *  - Pines y funciones alternas: verificados en ST DS12110 Rev 11 (tablas 9 y 10).
 *  - Componentes elegidos (PHY, GNSS, RS-485, LoRa): elegidos por conocimiento
 *    general del mercado. Sus hojas de datos NO se han revisado en esta sesión.
 *    Hay que confirmar disponibilidad, encapsulado, alimentación y pinout.
 *
 * El diseño original (`station-design.ts`) no se modifica: esto se superpone.
 */

import { DEBUG_INTERFACE, LQFP100_PIN, MCU_SIGNALS, RMII_PINS_LQFP100, type McuSignal } from './station-design';

export const PROPOSAL = {
  id: 'PROP-2026-11-11',
  author: 'Claude (asistente de IA), a petición del usuario',
  status: 'propuesta sin firmar' as const,
  requires: 'Revisión y firma de un ingeniero electrónico responsable antes de fabricar.',
};

const DS = 'ST DS12110 Rev 11';

export interface ProposedSignal extends McuSignal {
  lqfp100Pin: number;
  /** Línea EXTI que ocupa, si es una entrada de interrupción. */
  exti?: number;
  af?: number;
  rationale: string;
  evidence: string;
}

/** Señales que el diseño dejaba como «GPIO libre» o sin pin. */
export const PROPOSED_SIGNALS: ProposedSignal[] = [
  {
    signal: 'ACC_INT1', gpio: 'PD4', fn: 'GPIO/EXTI4', direction: 'entrada', lqfp100Pin: 85, exti: 4,
    rationale: 'J1-7. Pines 85–88 están junto a PB3–PB5 (89–91): el ruteo del acelerómetro queda agrupado.',
    evidence: `${DS}, tabla 9: PD4 pin 85; solo FMC/USART2/SAI3/HRTIM, ninguno usado.`,
  },
  {
    signal: 'ACC_INT2', gpio: 'PD5', fn: 'GPIO/EXTI5', direction: 'entrada', lqfp100Pin: 86, exti: 5,
    rationale: 'J1-8. Línea EXTI distinta de las demás interrupciones.',
    evidence: `${DS}, tabla 9: PD5 pin 86.`,
  },
  {
    signal: 'TILT_INT', gpio: 'PD6', fn: 'GPIO/EXTI6', direction: 'entrada', lqfp100Pin: 87, exti: 6,
    rationale: 'J2-7 (DRDY/INT). Solo se conecta si el carrier del SCL3300 lo ofrece; si no, J2-7 queda NC y el pin libre.',
    evidence: `${DS}, tabla 9: PD6 pin 87.`,
  },
  {
    signal: 'PWR_GOOD', gpio: 'PD7', fn: 'GPIO/EXTI7', direction: 'entrada', lqfp100Pin: 88, exti: 7,
    rationale: 'J6-4. Entra por optoacoplador o limitador (interfaces §3.6: «aislar/limitar hacia GPIO»), nunca directo.',
    evidence: `${DS}, tabla 9: PD7 pin 88.`,
  },
  {
    signal: 'SENSOR_SYNC', gpio: 'PA3', fn: 'TIM2_CH4 AF1', direction: 'salida', lqfp100Pin: 25, af: 1,
    rationale: 'Mismo temporizador (TIM2) que captura el PPS en PA0: el pulso de sincronía sale de la misma base de tiempo disciplinada por GNSS. ETH_MII_COL de este pin es solo MII; con RMII no se usa.',
    evidence: `${DS}, tablas 9 y 10: PA3 pin 25, TIM2_CH4 en AF1.`,
  },
  {
    signal: 'WDG_KICK', gpio: 'PE4', fn: 'GPIO', direction: 'salida', lqfp100Pin: 3,
    rationale: 'Watchdog externo. Sus funciones TRACED no se usan: no hay traza.',
    evidence: `${DS}, tabla 9: PE4 pin 3.`,
  },
  {
    signal: 'ETH_PHY_RST_N', gpio: 'PE5', fn: 'GPIO', direction: 'salida', lqfp100Pin: 4,
    rationale: 'Reset dedicado del PHY Ethernet, para poder recuperarlo sin reiniciar la estación.',
    evidence: `${DS}, tabla 9: PE5 pin 4.`,
  },
  {
    signal: 'LORA_RST_N', gpio: 'PE6', fn: 'GPIO', direction: 'salida', lqfp100Pin: 5,
    rationale: 'Reset del módulo LoRaWAN.',
    evidence: `${DS}, tabla 9: PE6 pin 5.`,
  },
  {
    signal: 'RS485_TX', gpio: 'PD8', fn: 'USART3_TX AF7', direction: 'salida', lqfp100Pin: 55, af: 7,
    rationale: 'USART3 tiene DE por hardware (PD12): el sentido del bus lo conmuta el periférico, sin temporizar por software.',
    evidence: `${DS}, tablas 9 y 10: PD8 pin 55, USART3_TX en AF7.`,
  },
  {
    signal: 'RS485_RX', gpio: 'PD9', fn: 'USART3_RX AF7', direction: 'entrada', lqfp100Pin: 56, af: 7,
    rationale: 'Pareja de PD8.',
    evidence: `${DS}, tablas 9 y 10: PD9 pin 56, USART3_RX en AF7.`,
  },
  {
    signal: 'RS485_DE', gpio: 'PD12', fn: 'USART3_RTS/DE AF7', direction: 'salida', lqfp100Pin: 59, af: 7,
    rationale: 'Habilitación del transmisor RS-485 controlada por la USART.',
    evidence: `${DS}, tablas 9 y 10: PD12 pin 59, USART3_RTS/USART3_DE en AF7.`,
  },
  {
    signal: 'LORA_TX', gpio: 'PE8', fn: 'UART7_TX AF7', direction: 'salida', lqfp100Pin: 38, af: 7,
    rationale: 'UART7 libre y separada de la del GNSS (USART1) y la del RS-485 (USART3).',
    evidence: `${DS}, tablas 9 y 10: PE8 pin 38, UART7_TX en AF7.`,
  },
  {
    signal: 'LORA_RX', gpio: 'PE7', fn: 'UART7_RX AF7', direction: 'entrada', lqfp100Pin: 37, af: 7,
    rationale: 'Pareja de PE8.',
    evidence: `${DS}, tablas 9 y 10: PE7 pin 37, UART7_RX en AF7.`,
  },
];

/** Líneas EXTI que ya ocupa el diseño original (ADC_DRDY_N en PE2). */
export const DESIGN_EXTI_LINES = [2];

export interface PartSelection {
  role: string;
  /** Lo que el diseño decía. */
  designSaid: string;
  choice: string;
  rationale: string;
  verified: false;
  verifyBefore: string;
}

export const PART_SELECTIONS: PartSelection[] = [
  {
    role: 'PHY Ethernet',
    designSaid: '«PHY externo seleccionado» (interfaces §3.6, J8), sin modelo.',
    choice: 'Microchip LAN8742AI-CZ (RMII 10/100, rango industrial)',
    rationale: 'RMII con el pinout ya reservado, soporte directo en las bibliotecas de ST y rango de temperatura industrial para un gabinete a la intemperie. Genera los 50 MHz de REF_CLK a partir de un cristal de 25 MHz y los entrega a PA1.',
    verified: false,
    verifyBefore: 'Hoja de datos del fabricante: modo de reloj REF_CLK, strapping de dirección PHY y alimentación.',
  },
  {
    role: 'Receptor GNSS de tiempo (TIME-01)',
    designSaid: 'Requisito: salida PPS, UART y tiempo UTC; sin modelo (BOM TIME-01).',
    choice: 'u-blox NEO-M8T o equivalente de tiempo con PPS y modo de posición fija',
    rationale: 'Un receptor de tiempo con la posición fija de una estación inmóvil mejora la estabilidad del PPS. El requisito del diseño (100 µs) queda varios órdenes por encima de lo que da cualquier PPS de este tipo.',
    verified: false,
    verifyBefore: 'Estado de producción con el distribuidor, alimentación y nivel lógico de la UART y del PPS.',
  },
  {
    role: 'Transceptor RS-485 (J9)',
    designSaid: '«Aislador, TVS de bus» (interfaces §3.6).',
    choice: 'Analog Devices ADM2587E (RS-485 aislado con alimentación aislada integrada)',
    rationale: 'Resuelve en un solo encapsulado el aislamiento que pide el diseño para recorridos al exterior, sin un DC/DC aislado aparte.',
    verified: false,
    verifyBefore: 'Hoja de datos: velocidad, tensión lógica de 3,3 V y requisitos de emisiones del convertidor aislado.',
  },
  {
    role: 'LoRaWAN (resumen y estado)',
    designSaid: '«LoRaWAN → health/status/compact summaries only», sin modelo.',
    choice: 'RAKwireless RAK3172 (STM32WLE5, comandos AT por UART)',
    rationale: 'Módulo certificado con la pila LoRaWAN dentro: el STM32H743 solo le manda resúmenes por UART7.',
    verified: false,
    verifyBefore: 'Plan de frecuencias aplicable en Colombia (ANE) y variante de banda del módulo.',
  },
  {
    role: 'LTE',
    designSaid: '«Ethernet/LTE → raw data files and management».',
    choice: 'Sin LTE en la estación. El crudo viaja por Ethernet al gateway (SHM-GW-001), y el LTE, si hace falta, va solo en el gateway.',
    rationale: 'El backhaul de las estaciones ya es Ethernet. Un módem LTE por estación multiplica consumo, coste y tarjetas SIM sin aportar nada mientras el Ethernet funcione. LoRaWAN cubre el estado si el Ethernet cae.',
    verified: false,
    verifyBefore: 'Que el presupuesto de energía y la topología del gateway lo confirmen.',
  },
];

export interface ProposedConnectorPin {
  pin: number | string;
  signal: string;
  volts: number | null;
}

export const PROPOSED_CONNECTORS: { id: string; serves: string; pins: ProposedConnectorPin[]; note: string }[] = [
  {
    id: 'J7', serves: 'Receptor GNSS (placa externa)',
    note: 'La placa del receptor lleva su propio regulador desde +5 V (rail de 5 V del diseño para GNSS y módem). Al MCU solo llegan señales de 3,3 V. Poner una resistencia serie y protección ESD en el PPS, porque entra por cable.',
    pins: [
      { pin: 1, signal: '+5V_GNSS', volts: 5 },
      { pin: 2, signal: 'DGND', volts: 0 },
      { pin: 3, signal: 'GNSS_TX', volts: 3.3 },
      { pin: 4, signal: 'GNSS_RX', volts: 3.3 },
      { pin: 5, signal: 'GNSS_PPS', volts: 3.3 },
      { pin: 6, signal: 'DGND', volts: 0 },
      { pin: 7, signal: 'NC', volts: null },
      { pin: 8, signal: 'SHIELD', volts: null },
    ],
  },
  {
    id: 'J9', serves: 'RS-485 aislado',
    note: 'Terminación de 120 Ω seleccionable por puente: solo en los extremos físicos del bus.',
    pins: [
      { pin: 1, signal: 'RS485_A', volts: null },
      { pin: 2, signal: 'RS485_B', volts: null },
      { pin: 3, signal: 'GND_ISO', volts: 0 },
      { pin: 4, signal: 'SHIELD', volts: null },
    ],
  },
  {
    id: 'J10', serves: 'Antena LoRaWAN',
    note: 'Coaxial SMA con descargador (interfaces §3.6). Sin LTE en la estación.',
    pins: [{ pin: 'RF', signal: 'LORA_ANT', volts: null }],
  },
];

export type PinOrigin = 'diseño' | 'corregido' | 'propuesta';

export interface PinoutRow extends McuSignal {
  origin: PinOrigin;
  lqfp100Pin: number | null;
}

/** Patilla física de un GPIO, del diseño o de la propuesta. */
export function pinNumber(gpio: string | null): number | null {
  if (!gpio) return null;
  return LQFP100_PIN[gpio] ?? PROPOSED_SIGNALS.find((p) => p.gpio === gpio)?.lqfp100Pin ?? null;
}

/** Pinout con el origen de cada asignación y su patilla física. */
export function pinoutTable(): PinoutRow[] {
  return fullPinout().map((s) => ({
    ...s,
    origin: s.proposed ? 'propuesta' : s.changedFrom ? 'corregido' : 'diseño',
    lqfp100Pin: pinNumber(s.gpio),
  }));
}

/** Pinout completo: el del diseño (con la corrección de SPI1) más lo propuesto. */
export function fullPinout(): (McuSignal & { proposed: boolean })[] {
  const proposedBySignal = new Map(PROPOSED_SIGNALS.map((p) => [p.signal, p]));
  const base = MCU_SIGNALS.map((s) => {
    const p = proposedBySignal.get(s.signal);
    return p ? { ...s, gpio: p.gpio, fn: p.fn, proposed: true } : { ...s, proposed: false };
  });
  const extra = PROPOSED_SIGNALS
    .filter((p) => !MCU_SIGNALS.some((s) => s.signal === p.signal))
    .map((p) => ({ ...p, proposed: true }));
  return [...base, ...extra];
}

/** Pines que nada debe usar: RMII y SWD. */
export function reservedPins(): Set<string> {
  return new Set([...Object.keys(RMII_PINS_LQFP100), DEBUG_INTERFACE.swd.swdio, DEBUG_INTERFACE.swd.swclk]);
}
