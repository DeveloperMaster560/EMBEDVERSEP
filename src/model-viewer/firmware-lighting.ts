/**
 * El alumbrado del puente gobernado por firmware de verdad.
 *
 * Diferencia con `lighting-state.ts`, que sigue existiendo y sigue siendo útil:
 *
 * - `lighting-state` **evalúa reglas**. Dice qué debería pasar según la lógica
 *   declarada en el modelo y la posición del sol. No ejecuta nada.
 * - esto **ejecuta el firmware** del armario de mando sobre un ATmega328P
 *   emulado. Las zonas se encienden porque el microcontrolador puso un pin
 *   alto, no porque una regla lo dedujera.
 *
 * Lo segundo es una simulación; lo primero no. Por eso están separados.
 *
 * Lo que sigue sin modelarse: no hay modelo eléctrico. Que una zona esté
 * energizada significa que la orden está dada, no que haya corriente. Las
 * potencias que se suman son las DECLARADAS en el modelo del puente, no
 * medidas ni calculadas aquí.
 */

import {
  BRIDGE_ZONE_PINS, BRIDGE_CONTROL_MODES, createBridgeLightingCircuit,
} from '../domain/bridgeLightingCircuit';
import { SimulationSession } from '../simulation/session';
import type { ButtonDevice, PhotocellDevice } from '../simulation/devices';
import { HexParseError } from '../simulation/intel-hex';
import type { LightingControl, LightingZone } from './lighting-state';

export interface FirmwareZoneState {
  zone: string;
  label: string;
  /** Etiqueta de la zona en el modelo del puente, si existe allí. */
  modelLabel: string | null;
  /**
   * ¿Existe esta zona en el modelo cargado?
   *
   * El firmware gobierna cuatro zonas siempre, pero un modelo puede tener
   * menos: un puente de vigas no tiene tirantes ni torres. Una salida
   * energizada sin zona en el modelo no ilumina nada, y hay que decirlo en vez
   * de pintar una zona encendida que no existe.
   */
  presentInModel: boolean;
  energized: boolean;
  /**
   * Fracción del tiempo en alto en la última ventana (PWM), o null si el pin
   * no ha cambiado desde la lectura anterior. Encendida con 0,1 es un 10 %.
   */
  duty: number | null;
  /** Pin del microcontrolador que la gobierna. */
  pin: string;
  fixtures: string[];
  fixtureCount: number;
  connectedPowerW: number | null;
}

export interface FirmwareLightingState {
  /** Modo que el propio firmware informa por el puerto serie. */
  mode: number;
  modeName: string;
  modeDetail: string;
  zones: FirmwareZoneState[];
  /** Componente del modelo → color con el que debe pintarse encendido. */
  litComponents: Map<string, string>;
  litCount: number;
  /** Suma de las potencias declaradas de las zonas energizadas. */
  totalPowerW: number | null;
  /** Por qué la potencia es nula, cuando lo es. */
  powerNote: string | null;
  serial: string;
  millis: number;
  /** Zonas del modelo que este firmware no gobierna. */
  unmatchedModelZones: string[];
  /**
   * Zonas que el firmware tiene energizadas pero que este modelo no tiene.
   *
   * No es un error del firmware ni del modelo: el mismo armario sirve a puentes
   * distintos. Pero hay que decirlo, porque esas salidas no encienden nada.
   */
  energizedWithoutModelZone: string[];
  /**
   * Avisos sobre el propio firmware: pines de zona que no configura como
   * salida, fotocelda que nunca lee… Un firmware que no usa los pines del
   * armario no enciende nada en el modelo, y eso hay que decirlo en vez de
   * dejar el puente apagado sin explicación.
   */
  firmwareWarnings: string[];
}

const UNKNOWN_MODE = {
  name: 'Sin informe',
  detail: 'El firmware todavía no ha informado de su modo por el puerto serie.',
};

/** Último modo informado por el firmware, o null si aún no dijo nada. */
export function parseReportedMode(serial: string): number | null {
  // El firmware emite «M<digito> <cuatro digitos>» en cada cambio. Interesa el
  // último, no el primero: es el estado vigente.
  const matches = serial.match(/M(\d)/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const digit = Number(last.slice(1));
  return Number.isInteger(digit) ? digit : null;
}

/** Firmware que no se puede ejecutar en el armario emulado, con el motivo. */
export class BridgeFirmwareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeFirmwareError';
  }
}

const SOLO_UNO = 'El armario del puente se emula con un ATmega328P (Arduino Uno): '
  + 'solo ejecuta el .hex que produce «Compilar» con la placa Arduino Uno R3.';

/** ¿Imagen de aplicación de Espressif? Empieza por 0xE9 (en 0x0, o en 0x1000 en el ESP32 clásico). */
function isEspressifImage(bytes: Uint8Array): boolean {
  if (bytes[0] === 0xe9) return true;
  if (bytes.length > 0x1000 && bytes[0x1000] === 0xe9) {
    for (let i = 0; i < 0x1000; i += 1) if (bytes[i] !== 0xff) return false;
    return true;
  }
  return false;
}

/**
 * Comprueba que un archivo es firmware ejecutable en el armario y devuelve su
 * texto Intel HEX. Si no lo es, explica qué es y por qué no se ejecuta, en vez
 * de fallar con un error de formato que nadie entiende.
 */
export function readBridgeFirmware(bytes: Uint8Array, fileName = 'el archivo'): string {
  if (bytes.length === 0) throw new BridgeFirmwareError(`${fileName} está vacío.`);
  if (bytes[0] === 0x55 && bytes[1] === 0x46 && bytes[2] === 0x32 && bytes[3] === 0x0a) {
    throw new BridgeFirmwareError(`${fileName} es un .uf2 (Raspberry Pi Pico u otra placa ARM). ${SOLO_UNO}`);
  }
  if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    throw new BridgeFirmwareError(`${fileName} es un ELF, no un .hex. ${SOLO_UNO}`);
  }
  if (isEspressifImage(bytes)) {
    throw new BridgeFirmwareError(
      `${fileName} es una imagen de ESP32/ESP8266. No hay emulador de ESP32 en el navegador, `
      + `así que no puede mover el modelo 3D. ${SOLO_UNO} El firmware del ESP32 sí se puede `
      + 'grabar en la placa real (ver «Compilar») o ejecutar en el PC con «Simular».',
    );
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '');
  if (!text.trimStart().startsWith(':')) {
    throw new BridgeFirmwareError(`${fileName} no es Intel HEX (un .bin plano o un código fuente). ${SOLO_UNO}`);
  }
  return text;
}

/** Registros de dirección de datos (DDRB, DDRC, DDRD) en el espacio de datos del ATmega328P. */
const DDR = { B: 0x24, C: 0x27, D: 0x2a } as const;

/** Nombre Arduino de cada pin según el registro y el bit. */
function pinName(port: 'B' | 'C' | 'D', bit: number): string {
  if (port === 'D') return `D${bit}`;
  if (port === 'B') return `D${bit + 8}`;
  return `A${bit}`;
}

/** Tiempo simulado tras el cual un pin no configurado ya no es «todavía no». */
const DIAGNOSIS_AFTER_MS = 100;

export class FirmwareLightingController {
  private readonly session: SimulationSession;
  private readonly photocell: PhotocellDevice | null;
  private readonly button: ButtonDevice | null;
  private readonly zonesByName: Map<string, LightingZone>;
  /** Pines que el firmware ha configurado como salida alguna vez. */
  private readonly outputsSeen = new Set<string>();
  /** Canales analógicos que el firmware ha convertido. */
  private readonly adcChannelsRead = new Set<number>();

  /**
   * @throws {BridgeFirmwareError} si el texto no es un Intel HEX ejecutable,
   *   con el motivo en palabras del usuario.
   */
  constructor(hex: string, control: LightingControl | null) {
    try {
      this.session = SimulationSession.fromHex(hex, createBridgeLightingCircuit());
    } catch (error) {
      if (error instanceof HexParseError) {
        throw new BridgeFirmwareError(`El .hex no se puede leer: ${error.message} ${SOLO_UNO}`);
      }
      throw error;
    }
    this.photocell = this.session.photocells[0] ?? null;
    this.button = this.session.buttons[0] ?? null;
    this.zonesByName = new Map((control?.zones ?? []).map((zone) => [zone.zone, zone]));

    // Saber qué canal convierte el firmware, sin alterar la conversión.
    const adc = this.session.runner.adc;
    const convert = adc.onADCRead;
    adc.onADCRead = (input) => {
      if ('channel' in input && typeof input.channel === 'number') this.adcChannelsRead.add(input.channel);
      convert(input);
    };
  }

  private noteOutputs(): void {
    const data = this.session.runner.cpu.data;
    for (const port of ['B', 'C', 'D'] as const) {
      const ddr = data[DDR[port]];
      const bits = port === 'C' ? 6 : port === 'B' ? 6 : 8;
      for (let bit = 0; bit < bits; bit += 1) {
        if (ddr & (1 << bit)) this.outputsSeen.add(pinName(port, bit));
      }
    }
  }

  /** Lo que el firmware hace distinto de lo que espera el armario. */
  private diagnose(millis: number): string[] {
    if (millis < DIAGNOSIS_AFTER_MS) return [];
    const warnings: string[] = [];
    const zonePins: string[] = BRIDGE_ZONE_PINS.map((item) => item.pin);
    const missing = BRIDGE_ZONE_PINS.filter((item) => !this.outputsSeen.has(item.pin));
    const others = [...this.outputsSeen]
      .filter((pin) => !zonePins.includes(pin) && pin !== 'D13' && pin !== 'D1')
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    if (missing.length === BRIDGE_ZONE_PINS.length) {
      warnings.push(
        'El firmware no ha configurado como salida ninguno de los pines de zona (D4 vial, D5 tirantes, '
        + `D6 torres, D7 barreras) en ${Math.round(millis)} ms: no puede encender nada en el modelo 3D.`
        + (others.length ? ` Usa como salida ${others.join(', ')}, que el armario no conecta a ninguna zona.` : ''),
      );
    } else if (missing.length > 0) {
      warnings.push(
        `Pines de zona que el firmware no configura como salida: ${missing.map((m) => `${m.pin} (${m.zone})`).join(', ')}. `
        + 'Esas zonas no se encenderán.',
      );
    }
    if (!this.adcChannelsRead.has(0)) {
      warnings.push('El firmware no ha leído A0: la luz de la escena (fotocelda) no le llega.');
    }
    return warnings;
  }

  /** ¿Se montó algo ejecutable? Si no, no hay que mostrar el panel. */
  get ready(): boolean {
    return this.photocell !== null && this.button !== null;
  }

  /** Mantener o soltar el pulsador de mando, como haría el operador. */
  setPressed(pressed: boolean): void {
    this.button?.setPressed(pressed);
  }

  /** Luz que ve la fotocelda, de 0 (noche cerrada) a 1 (pleno día). */
  setLight(light: number): void {
    this.photocell?.setLight(light);
  }

  advance(millis: number): FirmwareLightingState {
    // `run`, no `advance`: `state()` hace la única lectura de la ventana. Con
    // dos lecturas la segunda medía cero ciclos y el PWM se perdía.
    this.session.run(millis);
    return this.state();
  }

  state(): FirmwareLightingState {
    this.noteOutputs();
    const report = this.session.report();
    const reported = parseReportedMode(report.serial);
    const mode = reported ?? 0;
    const descriptor = BRIDGE_CONTROL_MODES.find((item) => item.mode === mode);

    const litComponents = new Map<string, string>();
    const zones: FirmwareZoneState[] = [];
    let power: number | null = 0;
    let powerNote: string | null = null;
    const missingButEnergized: string[] = [];

    for (const definition of BRIDGE_ZONE_PINS) {
      const reading = report.readings.find((item) => item.id === `led-${definition.zone}`);
      const energized = reading?.active ?? false;
      const modelZone = this.zonesByName.get(definition.zone);
      const fixtures = modelZone?.fixtures ?? [];

      if (energized && modelZone) {
        for (const fixture of fixtures) litComponents.set(fixture, definition.color);
        if (modelZone.connectedPowerW === null) {
          // Una zona encendida que existe pero no declara potencia invalida la
          // suma: dar un total parcial como si fuera el total sería engañoso.
          power = null;
          powerNote = `La zona «${definition.zone}» está encendida pero no declara `
            + 'potencia conectada en el modelo, así que el total no se puede sumar.';
        } else if (power !== null) {
          power += modelZone.connectedPowerW;
        }
      }
      // Una zona energizada que NO está en el modelo no ilumina nada, así que
      // aporta cero y no estropea la suma. Lo que hay que hacer es decirlo.
      if (energized && !modelZone) {
        missingButEnergized.push(definition.zone);
      }

      zones.push({
        zone: definition.zone,
        label: definition.label,
        modelLabel: modelZone?.label ?? null,
        presentInModel: modelZone !== undefined,
        energized,
        duty: reading?.duty ?? null,
        pin: definition.pin,
        fixtures,
        fixtureCount: modelZone?.fixtureCount ?? fixtures.length,
        connectedPowerW: modelZone?.connectedPowerW ?? null,
      });
    }

    const governed = new Set<string>(BRIDGE_ZONE_PINS.map((item) => item.zone));
    const unmatchedModelZones = [...this.zonesByName.keys()].filter((zone) => !governed.has(zone));

    return {
      mode,
      modeName: descriptor?.name ?? UNKNOWN_MODE.name,
      modeDetail: reported === null ? UNKNOWN_MODE.detail : descriptor?.detail ?? UNKNOWN_MODE.detail,
      zones,
      litComponents,
      litCount: litComponents.size,
      totalPowerW: power,
      powerNote,
      serial: report.serial,
      millis: report.millis,
      unmatchedModelZones,
      energizedWithoutModelZone: missingButEnergized,
      firmwareWarnings: this.diagnose(report.millis),
    };
  }
}
