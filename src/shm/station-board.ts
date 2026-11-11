/**
 * Disposición del esquema completo de la estación SHM: qué bloques rodean al
 * STM32H743 y qué red (señal) lleva cada uno de sus terminales.
 *
 * Las redes tienen el nombre de la señal del MCU (`MCU_SIGNALS`,
 * `PROPOSED_SIGNALS`), de la función RMII (`RMII_PINS_LQFP100`) o de SWD. La
 * patilla del chip a la que llegan se resuelve desde esos datos, nunca aquí.
 *
 * Nombres de terminal: los del documento de interfaces (§3) cuando los da; si
 * no, el nombre de la señal. No se inventan nombres de patilla de los
 * circuitos integrados, cuyas hojas de datos no se han revisado.
 */

export type PartSide = 'top' | 'bottom' | 'left' | 'right';
export type PartOrigin = 'diseño' | 'propuesta' | 'pendiente';

export interface PartPin {
  label: string;
  /** Red del MCU a la que va; `null` si no va al MCU (alimentación, campo). */
  net: string | null;
}

export interface BoardPart {
  id: string;
  title: string;
  subtitle: string;
  origin: PartOrigin;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Lado de la caja donde están los terminales que van al MCU. */
  side: PartSide;
  pins: PartPin[];
}

/** Bloques que no van al MCU: conectores de campo y etapas de potencia. */
export interface FieldBlock {
  id: string;
  title: string;
  subtitle: string;
  origin: PartOrigin;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Línea a otro bloque o parte: [x1, y1, x2, y2]. */
  link?: [number, number, number, number];
  power?: boolean;
}

export const BOARD_SIZE = { w: 1600, h: 1230 };
/** Desplazamiento del chip respecto a su dibujo base (cuerpo de 120 a 520). */
export const CHIP_OFFSET = { x: 480, y: 280 };

export const BOARD_PARTS: BoardPart[] = [
  {
    id: 'j6', title: 'J6 · Entrada', subtitle: '12/24 VDC', origin: 'diseño',
    x: 20, y: 40, w: 160, h: 190, side: 'right',
    pins: [
      { label: '1 VIN+', net: null },
      { label: '2 VIN−/RTN', net: null },
      { label: '3 PE', net: null },
      { label: '4 PWR_GOOD', net: 'PWR_GOOD' },
    ],
  },
  {
    id: 'scl3300', title: 'SCL3300-D01', subtitle: 'Inclinómetro · J2 · +3V3_S', origin: 'diseño',
    x: 470, y: 40, w: 170, h: 190, side: 'bottom',
    pins: [
      { label: 'SCK', net: 'ACC_SCK' },
      { label: 'MISO', net: 'ACC_MISO' },
      { label: 'MOSI', net: 'ACC_MOSI' },
      { label: 'CSB', net: 'TILT_CS_N' },
      { label: 'DRDY/INT', net: 'TILT_INT' },
    ],
  },
  {
    id: 'adxl355', title: 'ADXL355', subtitle: 'Acelerómetro · J1 · +3V3_A', origin: 'diseño',
    x: 660, y: 40, w: 210, h: 190, side: 'bottom',
    pins: [
      { label: 'SCLK', net: 'ACC_SCK' },
      { label: 'MISO', net: 'ACC_MISO' },
      { label: 'MOSI', net: 'ACC_MOSI' },
      { label: 'CS', net: 'ACC_CS_N' },
      { label: 'INT1', net: 'ACC_INT1' },
      { label: 'INT2', net: 'ACC_INT2' },
    ],
  },
  {
    id: 'microsd', title: 'microSD / eMMC', subtitle: 'Industrial · STOR-01', origin: 'diseño',
    x: 890, y: 40, w: 220, h: 190, side: 'bottom',
    pins: [
      { label: 'CMD', net: 'SDMMC_CMD' },
      { label: 'CK', net: 'SDMMC_CK' },
      { label: 'D3', net: 'SDMMC_D3' },
      { label: 'D2', net: 'SDMMC_D2' },
      { label: 'D1', net: 'SDMMC_D1' },
      { label: 'D0', net: 'SDMMC_D0' },
    ],
  },
  {
    id: 'ads1262', title: 'ADS1262', subtitle: 'ADC de precisión · rail analógico', origin: 'diseño',
    x: 190, y: 290, w: 220, h: 220, side: 'right',
    pins: [
      { label: 'DRDY', net: 'ADC_DRDY_N' },
      { label: 'RESET', net: 'ADC_RESET_N' },
      { label: 'CS', net: 'ADC_CS_N' },
      { label: 'SCLK', net: 'ACC_SCK' },
      { label: 'DOUT', net: 'ACC_MISO' },
      { label: 'DIN', net: 'ACC_MOSI' },
    ],
  },
  {
    id: 'wdg', title: 'Watchdog externo', subtitle: 'Modelo sin definir en el diseño', origin: 'pendiente',
    x: 190, y: 560, w: 220, h: 60, side: 'right',
    pins: [{ label: 'KICK', net: 'WDG_KICK' }],
  },
  {
    id: 'sync', title: 'Trigger cableado', subtitle: 'Opcional (interfaces §2)', origin: 'propuesta',
    x: 190, y: 770, w: 220, h: 60, side: 'right',
    pins: [{ label: 'SYNC', net: 'SENSOR_SYNC' }],
  },
  {
    id: 'swd', title: 'Depuración SWD', subtitle: 'Sin JTAG ni SWO', origin: 'diseño',
    x: 1160, y: 280, w: 200, h: 90, side: 'left',
    pins: [
      { label: 'SWDIO', net: 'SWDIO' },
      { label: 'SWCLK', net: 'SWCLK' },
    ],
  },
  {
    id: 'gnss', title: 'Receptor GNSS · J7', subtitle: 'u-blox NEO-M8T o equiv. · +5V_GNSS', origin: 'propuesta',
    x: 1160, y: 420, w: 230, h: 130, side: 'left',
    pins: [
      { label: 'J7-3 TX', net: 'GNSS_TX' },
      { label: 'J7-4 RX', net: 'GNSS_RX' },
      { label: 'J7-5 PPS', net: 'GNSS_PPS' },
    ],
  },
  {
    id: 'rs485', title: 'RS-485 aislado', subtitle: 'ADM2587E', origin: 'propuesta',
    x: 1160, y: 610, w: 230, h: 130, side: 'left',
    pins: [
      { label: 'TX', net: 'RS485_TX' },
      { label: 'RX', net: 'RS485_RX' },
      { label: 'DE', net: 'RS485_DE' },
    ],
  },
  {
    id: 'lora', title: 'LoRaWAN', subtitle: 'RAK3172 · solo estado', origin: 'propuesta',
    x: 560, y: 960, w: 220, h: 130, side: 'top',
    pins: [
      { label: 'RX', net: 'LORA_TX' },
      { label: 'TX', net: 'LORA_RX' },
      { label: 'RST', net: 'LORA_RST_N' },
    ],
  },
  {
    id: 'phy', title: 'PHY Ethernet', subtitle: 'LAN8742AI-CZ · cristal 25 MHz', origin: 'propuesta',
    x: 830, y: 960, w: 420, h: 150, side: 'top',
    pins: [
      { label: 'REF_CLK', net: 'ETH_RMII_REF_CLK' },
      { label: 'MDIO', net: 'ETH_MDIO' },
      { label: 'MDC', net: 'ETH_MDC' },
      { label: 'CRS_DV', net: 'ETH_RMII_CRS_DV' },
      { label: 'RXD0', net: 'ETH_RMII_RXD0' },
      { label: 'RXD1', net: 'ETH_RMII_RXD1' },
      { label: 'TX_EN', net: 'ETH_RMII_TX_EN' },
      { label: 'TXD0', net: 'ETH_RMII_TXD0' },
      { label: 'TXD1', net: 'ETH_RMII_TXD1' },
      { label: 'nRST', net: 'ETH_PHY_RST_N' },
    ],
  },
];

export const FIELD_BLOCKS: FieldBlock[] = [
  { id: 'prot', title: 'Fusible · inversión', subtitle: 'TVS · filtro EMI', origin: 'diseño', x: 205, y: 40, w: 150, h: 50, power: true, link: [180, 72, 205, 65] },
  { id: 'dc5', title: 'DC/DC 5 V', subtitle: '→ GNSS / módem', origin: 'diseño', x: 205, y: 105, w: 150, h: 38, power: true, link: [280, 90, 280, 105] },
  { id: 'dc33', title: 'DC/DC 3V3 digital', subtitle: '→ MCU, +3V3_A, +3V3_S', origin: 'diseño', x: 205, y: 150, w: 150, h: 38, power: true, link: [280, 143, 280, 150] },
  { id: 'dcan', title: 'DC/DC analógico', subtitle: '→ ADS1262 / excitación', origin: 'diseño', x: 205, y: 195, w: 150, h: 38, power: true, link: [280, 188, 280, 195] },
  { id: 'j3', title: 'J3 · Galgas', subtitle: '6 hilos', origin: 'diseño', x: 20, y: 300, w: 130, h: 50, link: [150, 325, 190, 325] },
  { id: 'j4', title: 'J4 · Pt100', subtitle: '4 hilos', origin: 'diseño', x: 20, y: 370, w: 130, h: 50, link: [150, 395, 190, 395] },
  { id: 'j5', title: 'J5 · 4–20 mA', subtitle: 'Receptor aislado', origin: 'diseño', x: 20, y: 440, w: 130, h: 50, link: [150, 465, 190, 465] },
  { id: 'j9', title: 'J9 · RS-485', subtitle: 'A / B / GND_ISO', origin: 'propuesta', x: 1430, y: 650, w: 150, h: 50, link: [1390, 675, 1430, 675] },
  { id: 'ant', title: 'Antena GNSS', subtitle: 'Exterior, cielo abierto', origin: 'diseño', x: 1430, y: 460, w: 150, h: 50, link: [1390, 485, 1430, 485] },
  { id: 'j10', title: 'J10 · SMA', subtitle: 'Antena LoRa', origin: 'propuesta', x: 595, y: 1140, w: 150, h: 50, link: [670, 1090, 670, 1140] },
  { id: 'j8', title: 'J8 · RJ45', subtitle: '10/100, magnetics', origin: 'diseño', x: 1290, y: 1010, w: 150, h: 50, link: [1250, 1035, 1290, 1035] },
];

/** Lo que el esquema deja fuera porque el diseño no lo define. */
export const BOARD_NOT_DRAWN =
  'No se dibujan los pasivos: cristales (PH0/PH1, PC14/PC15), condensadores VCAP y de desacoplo, BOOT0 y NRST. El diseño no los define.';
