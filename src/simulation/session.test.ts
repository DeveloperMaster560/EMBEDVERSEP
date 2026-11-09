import { describe, expect, it } from 'vitest';
import { assemble } from 'avr8js/dist/esm/utils/assembler';

import type { CircuitComponent, CircuitLibraryPackage, ElectronicCircuit } from '../domain/types';
import { SimulationSession } from './session';
import type { PhotocellDevice } from './devices';

function build(source: string): Uint16Array {
  const { bytes, errors } = assemble(source);
  if (errors.length) throw new Error(`El programa de prueba no ensambla: ${errors.join('; ')}`);
  return new Uint16Array(bytes.buffer, 0, bytes.length / 2);
}

const board: CircuitComponent = {
  id: 'board', kind: 'board', label: 'Arduino Uno R3', description: '',
};
const led: CircuitComponent = { id: 'd1', kind: 'led', label: 'D1 · LED', description: '' };
const resistor: CircuitComponent = { id: 'r1', kind: 'resistor', label: 'R1', description: '' };
const button: CircuitComponent = { id: 'sw1', kind: 'button', label: 'SW1', description: '' };

/** LED en D13 con su resistencia y retorno a masa. El montaje de siempre. */
const LED_ON_D13: ElectronicCircuit = {
  name: 'led', boardId: 'arduino-uno',
  components: [board, resistor, led],
  connections: [
    { from: 'board', fromPin: 'D13', to: 'r1', toPin: '1' },
    { from: 'r1', fromPin: '2', to: 'd1', toPin: 'A' },
    { from: 'd1', fromPin: 'K', to: 'board', toPin: 'GND' },
  ],
};

describe('el firmware enciende un LED del circuito', () => {
  it('deja el LED encendido mientras el pin está en alto', () => {
    const session = new SimulationSession(build(`
      ldi r16, 0x20
      out 0x04, r16   ; DDRB  = PB5 como salida
      out 0x05, r16   ; PORTB = alto
    fin:
      rjmp fin
    `), LED_ON_D13);

    expect(session.simulable).toBe(true);
    const report = session.advance(5);
    expect(report.readings).toHaveLength(1);
    expect(report.readings[0].active).toBe(true);
    expect(report.readings[0].label).toBe('D1 · LED');
    expect(report.millis).toBeGreaterThan(4.9);
  });

  it('lo deja apagado si el firmware no toca el pin', () => {
    const session = new SimulationSession(build(`
    fin:
      rjmp fin
    `), LED_ON_D13);
    expect(session.advance(2).readings[0].active).toBe(false);
  });

  /**
   * Cuentas a mano del bucle, del manual del ATmega328P:
   *   out (alto) 1 ciclo → el pin está alto 1 ciclo
   *   out (bajo) 1 ciclo + rjmp 2 ciclos → está bajo 3 ciclos
   * Periodo 4 ciclos, ciclo de trabajo 1/4. Si el medidor diera otra cosa,
   * estaría mal: esto no es una estimación.
   */
  it('mide el ciclo de trabajo exacto de un pin modulado', () => {
    const session = new SimulationSession(build(`
      ldi r16, 0x20
      ldi r17, 0x00
      out 0x04, r16
    loop:
      out 0x05, r16
      out 0x05, r17
      rjmp loop
    `), LED_ON_D13);

    session.advance(1);
    const report = session.advance(5);
    expect(report.readings[0].duty).toBeCloseTo(0.25, 4);
    // Un pin modulado cuenta como encendido: a 4 MHz el ojo no ve el parpadeo.
    expect(report.readings[0].active).toBe(true);
    expect(report.readings[0].detail).toMatch(/modulado al 25 %/);
  });
});

describe('distinguir modulación de un simple cambio de estado', () => {
  /**
   * Regresión. Un pin que cambia UNA vez dentro de la ventana de muestreo no
   * está modulado: ha cambiado de estado. Antes se tomaba su tiempo medio como
   * ciclo de trabajo y el LED se declaraba encendido justo después de apagarlo.
   */
  it('no confunde un cambio de estado con modulación', () => {
    const session = new SimulationSession(build(`
      ldi r16, 0x20
      ldi r17, 0x00
      out 0x04, r16
      out 0x05, r16   ; alto
      ldi r18, 0xff
    espera:
      dec r18
      brne espera     ; un rato en alto
      out 0x05, r17   ; y se queda bajo para siempre
    fin:
      rjmp fin
    `), LED_ON_D13);

    const report = session.advance(5);
    // Estuvo en alto una fracción de la ventana, pero acabó apagado.
    expect(report.readings[0].duty).toBeGreaterThan(0);
    expect(report.readings[0].duty).toBeLessThan(0.5);
    expect(report.readings[0].active).toBe(false);
    expect(report.readings[0].detail).toMatch(/apagado/);
  });
});

describe('el usuario acciona un pulsador y el firmware reacciona', () => {
  const circuit: ElectronicCircuit = {
    name: 'pulsador', boardId: 'arduino-uno',
    components: [board, resistor, led, button],
    connections: [
      { from: 'board', fromPin: 'D13', to: 'r1', toPin: '1' },
      { from: 'r1', fromPin: '2', to: 'd1', toPin: 'A' },
      { from: 'd1', fromPin: 'K', to: 'board', toPin: 'GND' },
      { from: 'board', fromPin: 'D2', to: 'sw1', toPin: '1' },
      { from: 'sw1', fromPin: '2', to: 'board', toPin: 'GND' },
    ],
  };

  /** Enciende el LED mientras PD2 esté a nivel bajo, o sea, mientras se pulsa. */
  const MIRROR = `
    ldi r16, 0x20
    ldi r19, 0x00
    out 0x04, r16     ; PB5 salida
  loop:
    in   r18, 0x09    ; PIND
    sbrc r18, 2       ; si PD2 = 0 (pulsado) se salta el rjmp
    rjmp apagar
    out  0x05, r16
    rjmp loop
  apagar:
    out  0x05, r19
    rjmp loop
  `;

  it('el LED sigue al pulsador en los dos sentidos', () => {
    const session = new SimulationSession(build(MIRROR), circuit);
    const [pulsador] = session.buttons;
    expect(pulsador).toBeDefined();

    // Suelto: la resistencia de polarización mantiene el pin en alto.
    expect(session.advance(1).readings.find((r) => r.kind === 'led')?.active).toBe(false);

    pulsador.setPressed(true);
    expect(session.advance(1).readings.find((r) => r.kind === 'led')?.active).toBe(true);

    pulsador.setPressed(false);
    expect(session.advance(1).readings.find((r) => r.kind === 'led')?.active).toBe(false);
  });

  it('informa del estado del propio pulsador', () => {
    const session = new SimulationSession(build(MIRROR), circuit);
    session.buttons[0].setPressed(true);
    const reading = session.advance(1).readings.find((r) => r.kind === 'button');
    expect(reading?.active).toBe(true);
    expect(reading?.detail).toMatch(/pulsado/);
    expect(reading?.detail).toMatch(/activo a nivel bajo/);
  });
});

describe('el firmware lee la fotocelda por el convertidor analógico', () => {
  const library: CircuitLibraryPackage = {
    schemaVersion: 1, id: 'lib', name: 'prueba', version: '1', license: 'CC0',
    components: [{
      id: 'fotocelda', name: 'Fotocelda LM393', manufacturer: '-', reference: 'LM393',
      category: 'optical', description: '', compatibleBoards: ['arduino-uno'],
      operatingVoltage: { min: 3.3, max: 5 }, interfaces: ['analog'],
      pins: [
        { id: 'VCC', label: 'VCC', type: 'power', x: 0, y: 0 },
        { id: 'GND', label: 'GND', type: 'ground', x: 0, y: 0 },
        { id: 'AO', label: 'AO', type: 'signal', x: 0, y: 0 },
      ],
    }],
  };

  const circuit: ElectronicCircuit = {
    name: 'alumbrado', boardId: 'arduino-uno',
    components: [
      board, resistor, led,
      { id: 'ldr', kind: 'custom', label: 'Fotocelda', description: '', libraryComponentId: 'fotocelda' },
    ],
    connections: [
      { from: 'board', fromPin: 'D13', to: 'r1', toPin: '1' },
      { from: 'r1', fromPin: '2', to: 'd1', toPin: 'A' },
      { from: 'd1', fromPin: 'K', to: 'board', toPin: 'GND' },
      { from: 'ldr', fromPin: 'AO', to: 'board', toPin: 'A4/SDA' },
    ],
    componentLibraries: [library],
  };

  /**
   * Enciende el LED cuando la lectura del ADC baja de 256 cuentas, es decir
   * cuando ADCH queda a cero. Es el mando de alumbrado más simple que existe:
   * poca luz, luces encendidas.
   */
  const DUSK = `
    ldi r16, 0x20
    ldi r19, 0x00
    out 0x04, r16
    ldi r20, 0x04
    sts 0x7C, r20     ; ADMUX = canal 4
    ldi r20, 0x87
    sts 0x7A, r20     ; ADCSRA = habilitado, división por 128
  loop:
    lds r21, 0x7A
    ori r21, 0x40
    sts 0x7A, r21     ; arranca la conversión
  espera:
    lds r21, 0x7A
    sbrc r21, 6
    rjmp espera       ; hasta que el bit de arranque vuelve a cero
    lds r22, 0x78     ; ADCL primero: leerlo bloquea los registros
    lds r23, 0x79     ; ADCH
    cpi r23, 0x00
    breq encender
    out 0x05, r19
    rjmp loop
  encender:
    out 0x05, r16
    rjmp loop
  `;

  it('las luces se encienden al oscurecer y se apagan con luz', () => {
    const session = new SimulationSession(build(DUSK), circuit);
    const [fotocelda] = session.photocells as PhotocellDevice[];
    expect(fotocelda.analogChannel).toBe(4);

    fotocelda.setLight(1);
    expect(session.advance(5).readings.find((r) => r.kind === 'led')?.active).toBe(false);

    // 10 % de 5 V son 0,5 V: unas 102 cuentas, por debajo de 256.
    fotocelda.setLight(0.1);
    expect(session.advance(5).readings.find((r) => r.kind === 'led')?.active).toBe(true);

    fotocelda.setLight(0.9);
    expect(session.advance(5).readings.find((r) => r.kind === 'led')?.active).toBe(false);
  });
});

describe('el relé obedece al firmware', () => {
  const library: CircuitLibraryPackage = {
    schemaVersion: 1, id: 'lib', name: 'prueba', version: '1', license: 'CC0',
    components: [{
      id: 'rele', name: 'Módulo de relé', manufacturer: '-', reference: 'SRD-05VDC',
      category: 'actuators', description: '', compatibleBoards: ['arduino-uno'],
      operatingVoltage: { min: 5, max: 5 }, interfaces: ['digital'],
      pins: [
        { id: 'VCC', label: 'VCC', type: 'power', x: 0, y: 0 },
        { id: 'GND', label: 'GND', type: 'ground', x: 0, y: 0 },
        { id: 'IN', label: 'IN', type: 'signal', x: 0, y: 0 },
      ],
    }],
  };
  const circuit: ElectronicCircuit = {
    name: 'rele', boardId: 'arduino-uno',
    components: [board, { id: 'k1', kind: 'custom', label: 'K1', description: '', libraryComponentId: 'rele' }],
    connections: [{ from: 'k1', fromPin: 'IN', to: 'board', toPin: 'D13' }],
    componentLibraries: [library],
  };

  it('cierra el contacto cuando el pin baja, que es como dispara el módulo', () => {
    const session = new SimulationSession(build(`
      ldi r16, 0x20
      out 0x04, r16   ; PB5 salida, queda en bajo
    fin:
      rjmp fin
    `), circuit);
    const report = session.advance(1);
    expect(report.readings[0].active).toBe(true);
    expect(report.readings[0].detail).toMatch(/contacto cerrado/);
  });

  it('lo abre cuando el pin sube', () => {
    const session = new SimulationSession(build(`
      ldi r16, 0x20
      out 0x04, r16
      out 0x05, r16   ; PORTB alto
    fin:
      rjmp fin
    `), circuit);
    expect(session.advance(1).readings[0].active).toBe(false);
  });
});

describe('lo que la sesión no puede simular', () => {
  it('arrastra los motivos para que la interfaz los muestre', () => {
    const session = new SimulationSession(build('fin: rjmp fin'), {
      name: 'imu', boardId: 'arduino-uno',
      components: [board, { id: 'u1', kind: 'mpu6050', label: 'U1', description: '' }],
      connections: [{ from: 'u1', fromPin: 'SDA', to: 'board', toPin: 'A4/SDA' }],
    });
    expect(session.simulable).toBe(false);
    expect(session.report().unresolved[0].reason).toMatch(/no hay modelo del MPU6050/);
  });

  it('rechaza un programa vacío en vez de fingir que corre', () => {
    expect(() => new SimulationSession(new Uint16Array(0), LED_ON_D13)).toThrow(/vacío/);
  });

  it('limita cuánto tiempo se puede pedir de una vez', () => {
    const session = new SimulationSession(build('fin: rjmp fin'), LED_ON_D13, { maxStepMillis: 10 });
    // Pedir media hora de golpe bloquearía el hilo: se recorta al tope.
    const report = session.advance(1_800_000);
    expect(report.millis).toBeLessThanOrEqual(10.001);
  });
});
