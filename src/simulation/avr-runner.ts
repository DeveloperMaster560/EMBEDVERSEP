/**
 * Adaptador de ejecución de firmware para ATmega328P (Arduino Uno R3).
 *
 * Qué es: un emulador del MICROCONTROLADOR. Ejecuta el código máquina real
 * que produce `arduino-cli` e informa del estado de los pines ciclo a ciclo.
 *
 * Qué NO es, y conviene tenerlo presente:
 *
 *  - No simula electricidad. No hay tensiones, corrientes ni resistencias. Un
 *    pin está alto o bajo; cuánta corriente puede entregar, o si el LED que
 *    hay detrás se quemaría, queda fuera.
 *  - No simula los componentes externos. Un sensor conectado a un pin no
 *    responde solo: alguien tiene que escribir su modelo.
 *  - No modela temperatura, ruido, tolerancias ni envejecimiento.
 *
 * `CAPABILITIES` enumera esto para que la interfaz pueda mostrarlo en vez de
 * dejar que el usuario lo suponga.
 */

import {
  AVRADC,
  AVRClock,
  AVRIOPort,
  AVRTimer,
  AVRTWI,
  AVRUSART,
  CPU,
  PinState,
  adcConfig,
  avrInstruction,
  clockConfig,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  twiConfig,
  usart0Config,
} from 'avr8js';

/** Reloj del Arduino Uno. Es un dato de la placa, no una elección. */
export const UNO_CLOCK_HZ = 16_000_000;

export type Fidelity = 'functional' | 'firmware-execution' | 'physics';

export interface SimulationCapabilities {
  mcu: string;
  boardLabel: string;
  clockHz: number;
  fidelity: Fidelity;
  /** Periféricos del microcontrolador que sí se ejecutan. */
  supported: string[];
  /** Lo que NO se simula. Se enumera para no dejarlo a la imaginación. */
  unsupported: string[];
}

export const CAPABILITIES: SimulationCapabilities = {
  mcu: 'ATmega328P',
  boardLabel: 'Arduino Uno R3',
  clockHz: UNO_CLOCK_HZ,
  fidelity: 'firmware-execution',
  supported: [
    'núcleo AVR (juego de instrucciones completo)',
    'GPIO: puertos B, C y D',
    'temporizadores 0, 1 y 2, con PWM',
    'USART0 (monitor serie)',
    'ADC (entradas analógicas)',
    'TWI / I²C (bus, sin dispositivos conectados)',
    'interrupciones y ciclos de reloj exactos',
  ],
  unsupported: [
    'tensiones, corrientes y potencia: no hay modelo eléctrico',
    'componentes externos: un sensor no responde si nadie lo modela',
    'temperatura, ruido, tolerancias y envejecimiento',
    'tiempos de arranque, rebotes y transitorios de alimentación',
    'SPI y EEPROM (disponibles en la biblioteca, aún no conectados aquí)',
  ],
};

/**
 * Correspondencia entre el número de pin que usa el programador en Arduino y
 * el puerto físico del microcontrolador. No es arbitraria: es el cableado de
 * la placa Uno.
 */
export type PortName = 'B' | 'C' | 'D';

export function arduinoPin(pin: number): { port: PortName; bit: number } {
  if (!Number.isInteger(pin)) throw new RangeError(`El pin ${pin} no es un entero.`);
  if (pin >= 0 && pin <= 7) return { port: 'D', bit: pin };
  if (pin >= 8 && pin <= 13) return { port: 'B', bit: pin - 8 };
  // A0..A5 se numeran 14..19 en el esquema de Arduino.
  if (pin >= 14 && pin <= 19) return { port: 'C', bit: pin - 14 };
  throw new RangeError(`El Arduino Uno no tiene el pin ${pin}. Los válidos son 0 a 19.`);
}

export interface PinChange {
  pin: number;
  high: boolean;
  /**
   * Ciclo en el que EMPIEZA la instrucción que provoca el cambio, no en el que
   * termina. El emulador notifica la escritura al registro antes de cobrar los
   * ciclos de la instrucción, y se conserva ese criterio en vez de maquillarlo:
   * quien compare esto con un analizador lógico debe saber a qué instante
   * corresponde la marca. Los INTERVALOS entre cambios no se ven afectados.
   */
  cycles: number;
  /** Microsegundos desde el arranque, derivados del ciclo y la frecuencia. */
  micros: number;
}

export interface RunnerOptions {
  clockHz?: number;
  /**
   * Tope de ciclos por llamada a `runCycles`. Evita que un firmware con un
   * bucle infinito sin salida bloquee el hilo indefinidamente.
   */
  maxCyclesPerRun?: number;
  /** Pines cuyos cambios se registran. Vacío = ninguno, para no gastar memoria. */
  watchPins?: number[];
}

/**
 * Ejecuta firmware AVR.
 *
 * El avance es explícito (`runCycles`, `runMicros`, `runMillis`): no hay
 * temporizador de fondo. Así la ejecución es reproducible —los mismos ciclos
 * dan siempre el mismo resultado— y las pruebas pueden ser exactas.
 */
export class AvrRunner {
  readonly cpu: CPU;
  readonly portB: AVRIOPort;
  readonly portC: AVRIOPort;
  readonly portD: AVRIOPort;
  readonly usart: AVRUSART;
  readonly adc: AVRADC;
  readonly twi: AVRTWI;
  readonly clockHz: number;

  // Los periféricos se conservan aunque el adaptador no los consulte: se
  // enganchan a la CPU al construirse y dejan de funcionar si se recolectan.
  // Además, quien use el adaptador puede querer inspeccionarlos.
  readonly timer0: AVRTimer;
  readonly timer1: AVRTimer;
  readonly timer2: AVRTimer;
  readonly clock: AVRClock;
  private readonly maxCyclesPerRun: number;
  private serialBuffer = '';
  private changes: PinChange[] = [];

  constructor(program: Uint16Array, options: RunnerOptions = {}) {
    if (program.length === 0) {
      throw new Error('El programa está vacío: no hay nada que ejecutar.');
    }
    this.clockHz = options.clockHz ?? UNO_CLOCK_HZ;
    this.maxCyclesPerRun = options.maxCyclesPerRun ?? this.clockHz * 10;

    this.cpu = new CPU(program);
    this.portB = new AVRIOPort(this.cpu, portBConfig);
    this.portC = new AVRIOPort(this.cpu, portCConfig);
    this.portD = new AVRIOPort(this.cpu, portDConfig);
    this.timer0 = new AVRTimer(this.cpu, timer0Config);
    this.timer1 = new AVRTimer(this.cpu, timer1Config);
    this.timer2 = new AVRTimer(this.cpu, timer2Config);
    this.clock = new AVRClock(this.cpu, this.clockHz, clockConfig);
    this.adc = new AVRADC(this.cpu, adcConfig);
    this.twi = new AVRTWI(this.cpu, twiConfig, this.clockHz);
    this.usart = new AVRUSART(this.cpu, usart0Config, this.clockHz);

    this.usart.onByteTransmit = (value: number) => {
      this.serialBuffer += String.fromCharCode(value);
    };

    for (const pin of options.watchPins ?? []) this.watch(pin);
  }

  /** Registra los cambios de un pin, con el ciclo exacto en que ocurren. */
  watch(pin: number): void {
    const { port, bit } = arduinoPin(pin);
    const target = this.portOf(port);
    let previous = target.pinState(bit) === PinState.High;
    target.addListener(() => {
      const high = target.pinState(bit) === PinState.High;
      if (high === previous) return;
      previous = high;
      this.changes.push({
        pin, high,
        cycles: this.cpu.cycles,
        micros: (this.cpu.cycles / this.clockHz) * 1e6,
      });
    });
  }

  /**
   * Avisa de cada cambio de un pin en el momento en que ocurre.
   *
   * `watch` acumula un historial para examinarlo después; esto es para quien
   * debe reaccionar al instante, como el modelo de un componente conectado a
   * ese pin. No registra nada, así que no consume memoria por cambio.
   */
  onPinChange(pin: number, listener: (high: boolean, cycles: number) => void): void {
    const { port, bit } = arduinoPin(pin);
    const target = this.portOf(port);
    let previous = target.pinState(bit) === PinState.High;
    target.addListener(() => {
      const high = target.pinState(bit) === PinState.High;
      if (high === previous) return;
      previous = high;
      listener(high, this.cpu.cycles);
    });
  }

  private portOf(name: PortName): AVRIOPort {
    return name === 'B' ? this.portB : name === 'C' ? this.portC : this.portD;
  }

  /** Estado actual de un pin de Arduino. */
  pinState(pin: number): PinState {
    const { port, bit } = arduinoPin(pin);
    return this.portOf(port).pinState(bit);
  }

  isHigh(pin: number): boolean {
    return this.pinState(pin) === PinState.High;
  }

  /** Fuerza el valor de entrada de un pin, como haría un sensor externo. */
  setPin(pin: number, high: boolean): void {
    const { port, bit } = arduinoPin(pin);
    this.portOf(port).setPin(bit, high);
  }

  /** Tensión de una entrada analógica, para que `analogRead` la lea. */
  setAnalogVoltage(channel: number, volts: number): void {
    if (channel < 0 || channel > 7) {
      throw new RangeError(`El ATmega328P no tiene el canal analógico ${channel}.`);
    }
    this.adc.channelValues[channel] = volts;
  }

  get cycles(): number {
    return this.cpu.cycles;
  }

  get micros(): number {
    return (this.cpu.cycles / this.clockHz) * 1e6;
  }

  get millis(): number {
    return (this.cpu.cycles / this.clockHz) * 1e3;
  }

  /** Lo que el firmware ha escrito por el puerto serie. */
  get serialOutput(): string {
    return this.serialBuffer;
  }

  /** Cambios de pin registrados, en orden. */
  get pinChanges(): readonly PinChange[] {
    return this.changes;
  }

  clearPinChanges(): void {
    this.changes = [];
  }

  /**
   * Avanza la ejecución.
   *
   * Devuelve los ciclos realmente consumidos, que pueden pasarse del objetivo
   * porque una instrucción no se parte por la mitad.
   */
  runCycles(cycles: number): number {
    if (!Number.isFinite(cycles) || cycles < 0) {
      throw new RangeError('El número de ciclos debe ser finito y no negativo.');
    }
    const limit = Math.min(cycles, this.maxCyclesPerRun);
    const target = this.cpu.cycles + limit;
    while (this.cpu.cycles < target) {
      avrInstruction(this.cpu);
      this.cpu.tick();
    }
    return this.cpu.cycles - (target - limit);
  }

  runMicros(micros: number): number {
    return this.runCycles(Math.round((micros * this.clockHz) / 1e6));
  }

  runMillis(millis: number): number {
    return this.runCycles(Math.round((millis * this.clockHz) / 1e3));
  }

  /**
   * Ejecuta hasta que se cumpla una condición, o hasta agotar el presupuesto.
   *
   * Devuelve si se cumplió. Un firmware que nunca llega a la condición debe
   * terminar informando de ello, no colgando la aplicación.
   */
  runUntil(predicate: () => boolean, maxCycles: number): boolean {
    const target = this.cpu.cycles + Math.min(maxCycles, this.maxCyclesPerRun);
    while (this.cpu.cycles < target) {
      if (predicate()) return true;
      avrInstruction(this.cpu);
      this.cpu.tick();
    }
    return predicate();
  }
}
