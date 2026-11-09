/**
 * Traduce un circuito dibujado a dispositivos conectados a pines concretos.
 *
 * Es el eslabón que faltaba. El emulador sabe ejecutar firmware y los modelos
 * de `devices` saben comportarse, pero alguien tiene que averiguar QUÉ hay
 * colgado de CADA pin, y eso solo se puede saber siguiendo los cables.
 *
 * Criterio firme: lo que no se puede deducir del cableado NO se inventa. Si un
 * LED no tiene camino hasta un pin de la placa, no se le asigna uno «probable»:
 * se devuelve en `unresolved` con el motivo. Un montaje mal cableado debe
 * fallar en la simulación igual que falla en la mesa.
 */

import type { BoardId, CircuitComponent, CircuitConnection, ElectronicCircuit } from '../domain/types';
import { getCircuitPins } from '../domain/circuit';
import { findLibraryComponent } from '../domain/componentLibrary';
import {
  ButtonDevice, InvertedLed, LedDevice, PhotocellDevice, RelayDevice,
  type SimulatedDevice,
} from './devices';

/** Un dispositivo que no se pudo conectar, y por qué. */
export interface UnresolvedDevice {
  componentId: string;
  label: string;
  reason: string;
}

export interface BindingResult {
  devices: SimulatedDevice[];
  unresolved: UnresolvedDevice[];
  /** Pines de Arduino que hay que vigilar para que los modelos reaccionen. */
  watchPins: number[];
  /** Canales del ADC en uso. */
  analogChannels: number[];
}

const node = (component: string, pin: string): string => `${component}\u0000${pin}`;

/**
 * Número de pin de Arduino a partir de la etiqueta de la placa.
 *
 * Acepta las etiquetas compuestas del editor («A4/SDA»). Devuelve null para lo
 * que no sea un pin numerable del ATmega328P: alimentación, masa y los GPIO del
 * ESP32, que este emulador no ejecuta.
 */
export function boardPinNumber(label: string): number | null {
  const token = label.trim().toUpperCase().split('/')[0];
  const digital = /^D(\d{1,2})$/.exec(token);
  if (digital) {
    const n = Number(digital[1]);
    return n >= 0 && n <= 13 ? n : null;
  }
  const analog = /^A(\d)$/.exec(token);
  if (analog) {
    const n = Number(analog[1]);
    // A0..A5 son los pines 14..19 en la numeración de Arduino.
    return n >= 0 && n <= 5 ? 14 + n : null;
  }
  return null;
}

/** Canal del ADC de un pin analógico, o null si el pin no es analógico. */
export function analogChannelOf(pin: number): number | null {
  return pin >= 14 && pin <= 19 ? pin - 14 : null;
}

/**
 * Red de nodos conectados.
 *
 * Dos pines están en la misma red si hay un cable entre ellos, directo o a
 * través de otros cables. Una resistencia en serie NO une sus dos patas en una
 * red: son dos redes distintas, y por eso hace falta atravesarla aparte.
 */
class Nets {
  private parent = new Map<string, string>();

  private find(x: string): string {
    const seen = this.parent.get(x);
    if (seen === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (seen === x) return x;
    const root = this.find(seen);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  same(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }

  members(x: string): string[] {
    const root = this.find(x);
    const out: string[] = [];
    for (const key of this.parent.keys()) {
      if (this.find(key) === root) out.push(key);
    }
    return out;
  }
}

/** Componentes que un tramo de señal puede atravesar. */
function passThroughPins(component: CircuitComponent): [string, string] | null {
  // Una resistencia en serie no cambia el nivel lógico: la señal la atraviesa.
  // Un condensador en serie BLOQUEA la continua, así que no se atraviesa.
  return component.kind === 'resistor' ? ['1', '2'] : null;
}

interface Traced {
  pin: number;
  /** Etiqueta del pin de la placa, para poder explicárselo al usuario. */
  label: string;
  /** Cuántos componentes se atravesaron por el camino. */
  hops: number;
}

/**
 * Busca un pin de la placa alcanzable desde un pin de un componente.
 *
 * Recorre redes y atraviesa resistencias. Devuelve el primer pin numerable que
 * encuentra, con el número de saltos, o null si no hay camino.
 */
function traceToBoardPin(
  start: string,
  nets: Nets,
  boardId: BoardId,
  boardComponent: CircuitComponent,
  byId: Map<string, CircuitComponent>,
): Traced | null {
  const boardPins = getCircuitPins(boardComponent, boardId);
  const visited = new Set<string>();
  let frontier = [start];
  let hops = 0;

  while (frontier.length && hops <= 4) {
    const reached = new Set<string>();
    for (const origin of frontier) {
      for (const member of nets.members(origin)) {
        if (visited.has(member)) continue;
        visited.add(member);
        const [componentId, pinId] = member.split('\u0000');
        if (componentId === boardComponent.id) {
          const found = boardPins.find((p) => p.id === pinId);
          const number = found ? boardPinNumber(found.id) : null;
          if (number !== null && found) return { pin: number, label: found.label, hops };
          continue;
        }
        const component = byId.get(componentId);
        if (!component) continue;
        const through = passThroughPins(component);
        if (!through) continue;
        const other = through[0] === pinId ? through[1] : through[1] === pinId ? through[0] : null;
        if (other !== null) reached.add(node(componentId, other));
      }
    }
    if (!reached.size) return null;
    frontier = [...reached];
    hops += 1;
  }
  return null;
}

/** ¿Este pin del componente llega a masa? */
function reachesRail(
  start: string,
  nets: Nets,
  byId: Map<string, CircuitComponent>,
  rail: 'ground' | 'power',
  boardComponent: CircuitComponent,
  boardId: BoardId,
): boolean {
  for (const member of nets.members(start)) {
    const [componentId, pinId] = member.split('\u0000');
    const component = byId.get(componentId);
    if (!component) continue;
    if (component.kind === rail) return true;
    if (componentId === boardComponent.id) {
      const found = getCircuitPins(boardComponent, boardId).find((p) => p.id === pinId);
      if (!found) continue;
      if (rail === 'ground' && found.type === 'ground') return true;
      if (rail === 'power' && found.type === 'power') return true;
    }
  }
  return false;
}

/** Nombres de pin que delatan el papel de un módulo de biblioteca. */
const ROLE_PINS = {
  analogOut: ['AO', 'AOUT', 'A0', 'OUT'],
  digitalOut: ['DO', 'DOUT', 'D0'],
  relayIn: ['IN', 'IN1', 'SIG'],
  i2c: ['SDA', 'SCL'],
} as const;

const hasPin = (pins: { id: string; label: string }[], names: readonly string[]): string | null => {
  for (const name of names) {
    const found = pins.find(
      (p) => p.id.toUpperCase() === name || p.label.trim().toUpperCase() === name,
    );
    if (found) return found.id;
  }
  return null;
};

/**
 * Construye los dispositivos simulables de un circuito.
 *
 * No modifica el circuito ni exige que esté completo: lo que no se reconoce o
 * no se puede trazar se devuelve explicado, no descartado en silencio.
 */
export function bindCircuit(circuit: ElectronicCircuit): BindingResult {
  const devices: SimulatedDevice[] = [];
  const unresolved: UnresolvedDevice[] = [];
  const byId = new Map(circuit.components.map((c) => [c.id, c]));
  const board = circuit.components.find((c) => c.kind === 'board' || c.kind === 'esp32');

  if (!board) {
    return {
      devices, watchPins: [], analogChannels: [],
      unresolved: circuit.components.map((c) => ({
        componentId: c.id, label: c.label,
        reason: 'El circuito no tiene placa, así que no hay pines a los que conectar nada.',
      })),
    };
  }
  if (board.kind === 'esp32') {
    return {
      devices, watchPins: [], analogChannels: [],
      unresolved: [{
        componentId: board.id, label: board.label,
        reason: 'El motor ejecuta ATmega328P (Arduino Uno). El ESP32 es otra arquitectura '
          + 'y no hay emulador para él: no se simula.',
      }],
    };
  }

  const nets = new Nets();
  for (const wire of circuit.connections as CircuitConnection[]) {
    const fromPin = wire.fromPin ?? defaultPin(byId.get(wire.from), circuit);
    const toPin = wire.toPin ?? defaultPin(byId.get(wire.to), circuit);
    if (fromPin === null || toPin === null) continue;
    nets.union(node(wire.from, fromPin), node(wire.to, toPin));
  }

  const trace = (start: string) => traceToBoardPin(start, nets, circuit.boardId, board, byId);
  const toGround = (start: string) =>
    reachesRail(start, nets, byId, 'ground', board, circuit.boardId);
  const toPower = (start: string) =>
    reachesRail(start, nets, byId, 'power', board, circuit.boardId);

  for (const component of circuit.components) {
    if (component.id === board.id) continue;
    if (component.kind === 'resistor' || component.kind === 'capacitor'
      || component.kind === 'power' || component.kind === 'ground') continue;

    if (component.kind === 'led') {
      const anode = trace(node(component.id, 'A'));
      const cathode = trace(node(component.id, 'K'));
      if (anode && toGround(node(component.id, 'K'))) {
        devices.push(new LedDevice(component.id, component.label, anode.pin));
      } else if (cathode && toPower(node(component.id, 'A'))) {
        // Montaje invertido: el pin hunde la corriente, enciende en nivel bajo.
        // No es un error, es otra forma de conectarlo, y hay que respetarla.
        devices.push(new InvertedLed(component.id, component.label, cathode.pin));
      } else if (anode) {
        unresolved.push({
          componentId: component.id, label: component.label,
          reason: `El ánodo llega al pin ${anode.label}, pero el cátodo no llega a masa. `
            + 'Sin retorno el LED no conduce.',
        });
      } else {
        unresolved.push({
          componentId: component.id, label: component.label,
          reason: 'Ninguna de sus patas llega a un pin numerable de la placa.',
        });
      }
      continue;
    }

    if (component.kind === 'button') {
      const one = trace(node(component.id, '1'));
      const two = trace(node(component.id, '2'));
      const signal = one ?? two;
      const otherSide = one ? '2' : '1';
      if (!signal) {
        unresolved.push({
          componentId: component.id, label: component.label,
          reason: 'Ninguno de sus contactos llega a un pin numerable de la placa.',
        });
        continue;
      }
      const grounded = toGround(node(component.id, otherSide));
      const powered = toPower(node(component.id, otherSide));
      if (!grounded && !powered) {
        unresolved.push({
          componentId: component.id, label: component.label,
          reason: `Un contacto llega al pin ${signal.label}, pero el otro no llega ni a masa `
            + 'ni a alimentación: pulsarlo no cambiaría nada.',
        });
        continue;
      }
      devices.push(new ButtonDevice(component.id, component.label, signal.pin, grounded));
      continue;
    }

    if (component.kind === 'mpu6050') {
      unresolved.push({
        componentId: component.id, label: component.label,
        reason: 'El bus I²C se emula, pero no hay modelo del MPU6050: no devolvería '
          + 'aceleraciones. Declarado sin simular en vez de inventar lecturas.',
      });
      continue;
    }

    if (component.kind === 'custom') {
      const definition = findLibraryComponent(circuit.componentLibraries, component.libraryComponentId);
      if (!definition) {
        unresolved.push({
          componentId: component.id, label: component.label,
          reason: 'Su definición de biblioteca no está cargada en el proyecto.',
        });
        continue;
      }
      const pins = definition.pins.map((p) => ({ id: p.id, label: p.label }));
      const relayIn = hasPin(pins, ROLE_PINS.relayIn);
      const analogOut = hasPin(pins, ROLE_PINS.analogOut);
      const digitalOut = hasPin(pins, ROLE_PINS.digitalOut);

      if (relayIn && !analogOut && !digitalOut) {
        const traced = trace(node(component.id, relayIn));
        if (!traced) {
          unresolved.push({
            componentId: component.id, label: component.label,
            reason: `Su entrada de mando (${relayIn}) no llega a un pin numerable de la placa.`,
          });
          continue;
        }
        devices.push(new RelayDevice(component.id, component.label, traced.pin));
        continue;
      }

      if (analogOut || digitalOut) {
        const analogTrace = analogOut ? trace(node(component.id, analogOut)) : null;
        const digitalTrace = digitalOut ? trace(node(component.id, digitalOut)) : null;
        const channel = analogTrace ? analogChannelOf(analogTrace.pin) : null;
        if (analogTrace && channel === null) {
          unresolved.push({
            componentId: component.id, label: component.label,
            reason: `Su salida analógica está en ${analogTrace.label}, que es un pin digital. `
              + 'El ADC solo lee A0 a A5.',
          });
          continue;
        }
        if (channel === null && !digitalTrace) {
          unresolved.push({
            componentId: component.id, label: component.label,
            reason: 'Ninguna de sus salidas llega a un pin numerable de la placa.',
          });
          continue;
        }
        devices.push(new PhotocellDevice(
          component.id, component.label, channel, digitalTrace ? digitalTrace.pin : null,
        ));
        continue;
      }

      if (hasPin(pins, ROLE_PINS.i2c)) {
        unresolved.push({
          componentId: component.id, label: component.label,
          reason: 'Habla por I²C. El bus se emula, pero no hay modelo de este módulo, '
            + 'así que no contestaría al microcontrolador.',
        });
        continue;
      }

      unresolved.push({
        componentId: component.id, label: component.label,
        reason: 'No se reconoce su papel por los nombres de sus pines. Para simularlo hace '
          + 'falta un modelo de comportamiento, que todavía no existe.',
      });
      continue;
    }

    unresolved.push({
      componentId: component.id, label: component.label,
      reason: `No hay modelo de simulación para un componente de tipo «${component.kind}».`,
    });
  }

  const watchPins = new Set<number>();
  const analogChannels = new Set<number>();
  for (const device of devices) {
    if (device instanceof LedDevice || device instanceof InvertedLed) watchPins.add(device.pin);
    if (device instanceof RelayDevice) watchPins.add(device.pin);
    if (device instanceof PhotocellDevice && device.analogChannel !== null) {
      analogChannels.add(device.analogChannel);
    }
  }

  return { devices, unresolved, watchPins: [...watchPins], analogChannels: [...analogChannels] };
}

/** Pin por omisión cuando una conexión antigua no lo indica. */
function defaultPin(component: CircuitComponent | undefined, circuit: ElectronicCircuit): string | null {
  if (!component) return null;
  const pins = getCircuitPins(component, circuit.boardId, circuit.componentLibraries);
  return pins.length ? pins[0].id : null;
}
