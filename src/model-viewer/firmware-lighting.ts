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

export class FirmwareLightingController {
  private readonly session: SimulationSession;
  private readonly photocell: PhotocellDevice | null;
  private readonly button: ButtonDevice | null;
  private readonly zonesByName: Map<string, LightingZone>;

  constructor(hex: string, control: LightingControl | null) {
    this.session = SimulationSession.fromHex(hex, createBridgeLightingCircuit());
    this.photocell = this.session.photocells[0] ?? null;
    this.button = this.session.buttons[0] ?? null;
    this.zonesByName = new Map((control?.zones ?? []).map((zone) => [zone.zone, zone]));
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
    this.session.advance(millis);
    return this.state();
  }

  state(): FirmwareLightingState {
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
    };
  }
}
