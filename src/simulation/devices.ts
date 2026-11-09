/**
 * Modelos de los componentes conectados al microcontrolador.
 *
 * El emulador de `avr-runner` ejecuta el ATmega328P, pero un pin en alto no
 * enciende nada por sí solo: hace falta decir qué hay conectado y cómo
 * reacciona. Eso es lo que vive aquí.
 *
 * Criterio: cada modelo describe COMPORTAMIENTO LÓGICO, no física. Un LED sabe
 * si está encendido y con qué ciclo de trabajo, no cuántos lúmenes entrega ni
 * cuánta corriente consume. Lo que un modelo no sabe, lo declara.
 */

import type { AvrRunner } from './avr-runner';

export type DeviceKind = 'led' | 'button' | 'photocell' | 'relay';

export interface DeviceReading {
  id: string;
  kind: DeviceKind;
  label: string;
  /** Estado principal, para pintar: encendido, pulsado, contacto cerrado… */
  active: boolean;
  /**
   * Fracción de tiempo en alto desde la lectura anterior, de 0 a 1. Con PWM
   * (`analogWrite`) esto es lo que de verdad ve el componente. Es `null` si
   * todavía no se ha medido ningún intervalo.
   */
  duty: number | null;
  /** Texto corto para la interfaz. */
  detail: string;
}

export interface SimulatedDevice {
  readonly id: string;
  readonly kind: DeviceKind;
  readonly label: string;
  /** Se engancha al emulador. Se llama una vez, al iniciar la sesión. */
  attach(runner: AvrRunner): void;
  /** Lee el estado y reinicia los acumuladores de la ventana. */
  sample(runner: AvrRunner): DeviceReading;
}

/**
 * Mide cuánto tiempo pasa un pin en alto.
 *
 * Se apoya en los ciclos de reloj, no en el reloj del ordenador: así el ciclo
 * de trabajo medido es exacto y reproducible, y no depende de lo rápido que
 * vaya la máquina que ejecuta la simulación.
 */
class Duty {
  private high = 0;
  private low = 0;
  private edges = 0;
  private lastCycle = 0;
  private lastHigh = false;
  private started = false;

  begin(cycles: number, high: boolean): void {
    this.lastCycle = cycles;
    this.lastHigh = high;
    this.started = true;
  }

  change(cycles: number, high: boolean): void {
    if (!this.started) {
      this.begin(cycles, high);
      return;
    }
    this.accumulate(cycles);
    this.lastHigh = high;
    this.edges += 1;
  }

  private accumulate(cycles: number): void {
    const elapsed = cycles - this.lastCycle;
    if (elapsed > 0) {
      if (this.lastHigh) this.high += elapsed;
      else this.low += elapsed;
    }
    this.lastCycle = cycles;
  }

  readAndReset(cycles: number): { duty: number | null; edges: number } {
    if (!this.started) return { duty: null, edges: 0 };
    this.accumulate(cycles);
    const total = this.high + this.low;
    const result = { duty: total === 0 ? null : this.high / total, edges: this.edges };
    this.high = 0;
    this.low = 0;
    this.edges = 0;
    return result;
  }
}

/** Umbral a partir del cual se considera que un pin está modulado, no fijo. */
const MODULATION_BAND = 0.001;

/**
 * Mínimo de flancos para hablar de modulación.
 *
 * Hace falta contarlos: un pin que cambia UNA vez dentro de la ventana no está
 * modulado, simplemente ha cambiado de estado, y dar su tiempo medio como
 * «brillo» sería falso. Con PWM de verdad hay decenas de flancos por ventana.
 */
const MODULATION_EDGES = 4;

const isModulated = (duty: number | null, edges: number): duty is number =>
  edges >= MODULATION_EDGES
  && duty !== null && duty > MODULATION_BAND && duty < 1 - MODULATION_BAND;

/**
 * LED.
 *
 * Se asume ánodo hacia el pin y cátodo a masa, que es el montaje habitual: el
 * pin en alto lo enciende. No se modela la resistencia en serie —no hay modelo
 * eléctrico— ni el brillo real en lúmenes.
 */
export class LedDevice implements SimulatedDevice {
  readonly kind = 'led' as const;
  readonly id: string;
  readonly label: string;
  readonly pin: number;
  private duty = new Duty();
  protected high = false;

  constructor(id: string, label: string, pin: number) {
    this.id = id;
    this.label = label;
    this.pin = pin;
  }

  attach(runner: AvrRunner): void {
    this.high = runner.isHigh(this.pin);
    this.duty.begin(runner.cycles, this.high);
    runner.onPinChange(this.pin, (high, cycles) => {
      this.high = high;
      this.duty.change(cycles, high);
    });
  }

  sample(runner: AvrRunner): DeviceReading {
    const { duty, edges } = this.duty.readAndReset(runner.cycles);
    // Con PWM el pin conmuta cientos de veces por segundo: lo que importa no es
    // el instante del muestreo sino la proporción de tiempo encendido.
    return this.describe(duty, edges, this.high);
  }

  protected describe(duty: number | null, edges: number, high: boolean): DeviceReading {
    const modulated = isModulated(duty, edges);
    return {
      id: this.id, kind: this.kind, label: this.label,
      active: modulated ? true : high,
      duty,
      detail: modulated
        ? `pin ${this.pin} · modulado al ${(duty * 100).toFixed(0)} %`
        : `pin ${this.pin} · ${high ? 'encendido' : 'apagado'}`,
    };
  }
}

/**
 * LED cableado contra alimentación: el pin hunde la corriente y enciende
 * cuando baja. No es un error de montaje, es otra forma de conectarlo.
 */
export class InvertedLed extends LedDevice {
  protected override describe(duty: number | null, edges: number, high: boolean): DeviceReading {
    const inverted = duty === null ? null : 1 - duty;
    const modulated = isModulated(inverted, edges);
    const on = modulated ? true : !high;
    return {
      id: this.id, kind: this.kind, label: this.label,
      active: on,
      duty: inverted,
      detail: modulated
        ? `pin ${this.pin} · modulado al ${(inverted * 100).toFixed(0)} % (enciende en nivel bajo)`
        : `pin ${this.pin} · ${on ? 'encendido' : 'apagado'} (enciende en nivel bajo)`,
    };
  }
}

/**
 * Pulsador.
 *
 * El estado lo impone el usuario, no el firmware. `activeLow` cubre el montaje
 * más común en Arduino: resistencia de polarización arriba y pulsador a masa,
 * donde pulsar pone el pin a CERO. Confundir esa polaridad es el error clásico.
 */
export class ButtonDevice implements SimulatedDevice {
  readonly kind = 'button' as const;
  readonly id: string;
  readonly label: string;
  readonly pin: number;
  readonly activeLow: boolean;
  private pressed = false;
  private runner: AvrRunner | null = null;

  constructor(id: string, label: string, pin: number, activeLow = true) {
    this.id = id;
    this.label = label;
    this.pin = pin;
    this.activeLow = activeLow;
  }

  attach(runner: AvrRunner): void {
    this.runner = runner;
    this.apply();
  }

  setPressed(pressed: boolean): void {
    this.pressed = pressed;
    this.apply();
  }

  private apply(): void {
    if (!this.runner) return;
    this.runner.setPin(this.pin, this.activeLow ? !this.pressed : this.pressed);
  }

  sample(): DeviceReading {
    return {
      id: this.id, kind: this.kind, label: this.label,
      active: this.pressed, duty: null,
      detail: `pin ${this.pin} · ${this.pressed ? 'pulsado' : 'suelto'}`
        + (this.activeLow ? ' (activo a nivel bajo)' : ''),
    };
  }
}

/**
 * Módulo de fotocelda tipo LM393.
 *
 * Entrega dos cosas: una salida analógica proporcional a la luz y una salida
 * digital que se activa al cruzar un umbral. En el módulo real ese umbral lo
 * fija un potenciómetro; aquí lo fija el usuario, y queda declarado que es un
 * ajuste del montaje y no un valor calculado.
 *
 * `light` va de 0 (oscuridad total) a 1 (plena luz).
 */
export class PhotocellDevice implements SimulatedDevice {
  readonly kind = 'photocell' as const;
  readonly id: string;
  readonly label: string;
  /** Canal del ADC de la salida analógica, o null si no está cableada. */
  readonly analogChannel: number | null;
  /** Pin digital de la salida DO, o null si no está cableada. */
  readonly digitalPin: number | null;
  readonly supplyVolts: number;
  /** Umbral del potenciómetro del módulo, de 0 a 1. Lo ajusta el usuario. */
  threshold: number;
  private light = 1;
  private runner: AvrRunner | null = null;

  constructor(
    id: string,
    label: string,
    analogChannel: number | null,
    digitalPin: number | null,
    supplyVolts = 5,
    threshold = 0.35,
  ) {
    this.id = id;
    this.label = label;
    this.analogChannel = analogChannel;
    this.digitalPin = digitalPin;
    this.supplyVolts = supplyVolts;
    this.threshold = threshold;
  }

  attach(runner: AvrRunner): void {
    this.runner = runner;
    this.apply();
  }

  setLight(light: number): void {
    this.light = Math.min(1, Math.max(0, light));
    this.apply();
  }

  setThreshold(threshold: number): void {
    this.threshold = Math.min(1, Math.max(0, threshold));
    this.apply();
  }

  private apply(): void {
    if (!this.runner) return;
    if (this.analogChannel !== null) {
      this.runner.setAnalogVoltage(this.analogChannel, this.light * this.supplyVolts);
    }
    if (this.digitalPin !== null) {
      // La salida DO del LM393 va a nivel BAJO cuando la luz supera el umbral.
      this.runner.setPin(this.digitalPin, this.light < this.threshold);
    }
  }

  get dark(): boolean {
    return this.light < this.threshold;
  }

  sample(): DeviceReading {
    return {
      id: this.id, kind: this.kind, label: this.label,
      active: this.dark, duty: null,
      detail:
        `luz ${(this.light * 100).toFixed(0)} % · umbral ${(this.threshold * 100).toFixed(0)} % · `
        + (this.dark ? 'oscuridad detectada' : 'hay luz'),
    };
  }
}

/**
 * Módulo de relé.
 *
 * Modela la bobina y el contacto, nada más. Lo que el contacto conmuta queda
 * fuera: aquí no hay tensiones ni corrientes, así que el relé no sabe si la
 * carga que gobierna es un LED o un circuito de alumbrado de varios kilovatios.
 */
export class RelayDevice implements SimulatedDevice {
  readonly kind = 'relay' as const;
  readonly id: string;
  readonly label: string;
  readonly pin: number;
  /** Casi todos los módulos de relé de bajo coste disparan con nivel BAJO. */
  readonly activeLow: boolean;
  private energized = false;

  constructor(id: string, label: string, pin: number, activeLow = true) {
    this.id = id;
    this.label = label;
    this.pin = pin;
    this.activeLow = activeLow;
  }

  attach(runner: AvrRunner): void {
    this.update(runner.isHigh(this.pin));
    runner.onPinChange(this.pin, (high) => this.update(high));
  }

  private update(high: boolean): void {
    this.energized = this.activeLow ? !high : high;
  }

  sample(): DeviceReading {
    return {
      id: this.id, kind: this.kind, label: this.label,
      active: this.energized, duty: null,
      detail: `pin ${this.pin} · contacto ${this.energized ? 'cerrado' : 'abierto'}`
        + (this.activeLow ? ' (dispara a nivel bajo)' : ''),
    };
  }
}
