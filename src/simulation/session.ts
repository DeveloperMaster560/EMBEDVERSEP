/**
 * Sesión de simulación: firmware + circuito + tiempo.
 *
 * Junta las tres piezas. `avr-runner` ejecuta el microcontrolador, `devices`
 * dice cómo reaccionan los componentes, `binding` averigua qué hay en cada pin,
 * y esto lo hace avanzar y entrega el estado para pintarlo.
 *
 * El avance es explícito y en milisegundos simulados. No hay temporizador
 * propio: quien use la sesión decide cuándo y cuánto avanza. Así la misma
 * secuencia de llamadas da siempre el mismo resultado, y las pruebas pueden
 * comprobar instantes exactos en vez de esperar a ver qué pasa.
 */

import type { ElectronicCircuit } from '../domain/types';
import { AvrRunner, UNO_CLOCK_HZ } from './avr-runner';
import { bindCircuit, type UnresolvedDevice } from './binding';
import {
  ButtonDevice, PhotocellDevice,
  type DeviceReading, type SimulatedDevice,
} from './devices';
import { parseIntelHex, toProgramMemory } from './intel-hex';

export interface SessionReport {
  /** Milisegundos simulados desde el arranque del firmware. */
  millis: number;
  /** Ciclos de reloj consumidos. */
  cycles: number;
  readings: DeviceReading[];
  /** Lo nuevo que el firmware ha escrito por el puerto serie. */
  serialChunk: string;
  /** Todo lo que ha escrito por el puerto serie desde el arranque. */
  serial: string;
  /** Componentes del circuito que no se pueden simular, con el motivo. */
  unresolved: UnresolvedDevice[];
}

export interface SessionOptions {
  clockHz?: number;
  /**
   * Tope de milisegundos simulados por llamada a `advance`. Evita que una
   * pestaña que vuelve de segundo plano pida de golpe media hora de
   * simulación y bloquee el hilo.
   */
  maxStepMillis?: number;
}

const DEFAULT_MAX_STEP_MS = 50;

export class SimulationSession {
  readonly runner: AvrRunner;
  readonly devices: readonly SimulatedDevice[];
  readonly unresolved: readonly UnresolvedDevice[];
  private readonly maxStepMillis: number;
  private serialRead = 0;

  constructor(program: Uint16Array, circuit: ElectronicCircuit, options: SessionOptions = {}) {
    const bound = bindCircuit(circuit);
    this.devices = bound.devices;
    this.unresolved = bound.unresolved;
    this.maxStepMillis = options.maxStepMillis ?? DEFAULT_MAX_STEP_MS;

    this.runner = new AvrRunner(program, {
      clockHz: options.clockHz ?? UNO_CLOCK_HZ,
      watchPins: bound.watchPins,
    });

    // Las entradas se fijan ANTES de ejecutar la primera instrucción: si no,
    // el firmware leería un pin flotante en su primer `digitalRead`.
    for (const device of this.devices) device.attach(this.runner);
  }

  /** Construye una sesión desde el HEX que devuelve el compilador. */
  static fromHex(
    hex: string,
    circuit: ElectronicCircuit,
    options: SessionOptions = {},
  ): SimulationSession {
    return new SimulationSession(toProgramMemory(parseIntelHex(hex)), circuit, options);
  }

  /**
   * Avanza la simulación y devuelve el estado resultante.
   *
   * Devuelve los milisegundos realmente simulados, que pueden ser menos de los
   * pedidos si se alcanzó el tope.
   */
  advance(millis: number): SessionReport {
    const step = Math.max(0, Math.min(millis, this.maxStepMillis));
    if (step > 0) this.runner.runMillis(step);
    return this.report();
  }

  /** Estado actual, sin avanzar el tiempo. */
  report(): SessionReport {
    const serial = this.runner.serialOutput;
    const serialChunk = serial.slice(this.serialRead);
    this.serialRead = serial.length;
    return {
      millis: this.runner.millis,
      cycles: this.runner.cycles,
      readings: this.devices.map((device) => device.sample(this.runner)),
      serialChunk,
      serial,
      unresolved: [...this.unresolved],
    };
  }

  /** Pulsadores, para que la interfaz pueda accionarlos. */
  get buttons(): ButtonDevice[] {
    return this.devices.filter((d): d is ButtonDevice => d instanceof ButtonDevice);
  }

  /** Fotoceldas, para que la interfaz pueda variar la luz. */
  get photocells(): PhotocellDevice[] {
    return this.devices.filter((d): d is PhotocellDevice => d instanceof PhotocellDevice);
  }

  /** ¿Hay algo que simular? Un circuito sin dispositivos reconocidos no sirve. */
  get simulable(): boolean {
    return this.devices.length > 0;
  }
}
