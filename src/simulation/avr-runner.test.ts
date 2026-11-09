import { describe, expect, it } from 'vitest';
// El ensamblador de avr8js no se reexporta en la raíz del paquete; se importa
// por ruta. Solo se usa en pruebas: el firmware real llega compilado en .hex.
import { assemble } from 'avr8js/dist/esm/utils/assembler';

import { AvrRunner, UNO_CLOCK_HZ, arduinoPin } from './avr-runner';

function build(source: string): Uint16Array {
  const { bytes, errors } = assemble(source);
  if (errors.length) throw new Error(`El programa de prueba no ensambla: ${errors.join('; ')}`);
  return new Uint16Array(bytes.buffer, 0, bytes.length / 2);
}

/**
 * Conmuta PB5 (pin 13) en el bucle más corto posible.
 *
 * Cuentas a mano, del manual del ATmega328P:
 *   out  → 1 ciclo
 *   rjmp → 2 ciclos
 * El cuerpo del bucle son dos `out` y un `rjmp`: 1 + 1 + 2 = 4 ciclos.
 */
const TOGGLE = `
  ldi r16, 0x20
  ldi r17, 0x00
  out 0x04, r16   ; DDRB  = 0x20, PB5 como salida
loop:
  out 0x05, r16   ; PORTB = 0x20, alto
  out 0x05, r17   ; PORTB = 0x00, bajo
  rjmp loop
`;

describe('correspondencia de pines del Arduino Uno', () => {
  it('coloca cada pin en su puerto físico', () => {
    expect(arduinoPin(0)).toEqual({ port: 'D', bit: 0 });
    expect(arduinoPin(7)).toEqual({ port: 'D', bit: 7 });
    expect(arduinoPin(8)).toEqual({ port: 'B', bit: 0 });
    expect(arduinoPin(13)).toEqual({ port: 'B', bit: 5 });
    expect(arduinoPin(14)).toEqual({ port: 'C', bit: 0 });
  });

  it('rechaza un pin que la placa no tiene', () => {
    expect(() => arduinoPin(20)).toThrow(/no tiene el pin 20/);
    expect(() => arduinoPin(-1)).toThrow();
    expect(() => arduinoPin(1.5)).toThrow(/no es un entero/);
  });
});

describe('ejecución de firmware, ciclo a ciclo', () => {
  it('conmuta el pin con el periodo que dicta el juego de instrucciones', () => {
    const runner = new AvrRunner(build(TOGGLE), { watchPins: [13] });
    runner.runCycles(40);

    const highs = runner.pinChanges.filter((c) => c.high).map((c) => c.cycles);
    expect(highs.length).toBeGreaterThanOrEqual(4);
    // El intervalo es la afirmación comprobable: 4 ciclos, calculados a mano.
    for (let i = 1; i < highs.length; i += 1) {
      expect(highs[i] - highs[i - 1], `flanco ${i}`).toBe(4);
    }
  });

  it('el pin pasa por alto y bajo de forma alterna, sin repetir estado', () => {
    const runner = new AvrRunner(build(TOGGLE), { watchPins: [13] });
    runner.runCycles(40);
    const states = runner.pinChanges.map((c) => c.high);
    for (let i = 1; i < states.length; i += 1) {
      expect(states[i], `cambio ${i}`).not.toBe(states[i - 1]);
    }
  });

  it('traduce ciclos a tiempo con el reloj real de la placa', () => {
    const runner = new AvrRunner(build(TOGGLE));
    runner.runCycles(16_000);
    // 16.000 ciclos a 16 MHz son exactamente 1 ms.
    expect(runner.millis).toBeCloseTo(1, 9);
    expect(runner.micros).toBeCloseTo(1000, 6);
    expect(UNO_CLOCK_HZ).toBe(16_000_000);
  });

  it('avanza exactamente los ciclos pedidos por runMillis', () => {
    const runner = new AvrRunner(build(TOGGLE));
    runner.runMillis(2);
    expect(runner.cycles).toBeGreaterThanOrEqual(32_000);
    // No se pasa de una instrucción: el bucle son instrucciones de 1 y 2 ciclos.
    expect(runner.cycles).toBeLessThan(32_000 + 2);
  });

  it('la ejecución es reproducible: los mismos ciclos dan el mismo resultado', () => {
    const a = new AvrRunner(build(TOGGLE), { watchPins: [13] });
    const b = new AvrRunner(build(TOGGLE), { watchPins: [13] });
    a.runCycles(500);
    b.runCycles(500);
    expect(a.pinChanges).toEqual(b.pinChanges);
    expect(a.cycles).toBe(b.cycles);
  });

  it('rechaza un programa vacío en vez de ejecutar basura', () => {
    expect(() => new AvrRunner(new Uint16Array(0))).toThrow(/vacío/);
  });

  it('no se cuelga con un presupuesto de ciclos agotado', () => {
    const runner = new AvrRunner(build('bucle: rjmp bucle'), { maxCyclesPerRun: 100 });
    runner.runCycles(10_000_000);
    expect(runner.cycles).toBeLessThanOrEqual(101);
  });

  it('runUntil informa de que no se cumplió, en vez de colgarse', () => {
    const runner = new AvrRunner(build('bucle: rjmp bucle'));
    expect(runner.runUntil(() => runner.isHigh(13), 1000)).toBe(false);
  });
});

describe('puerto serie', () => {
  it('entrega lo que el firmware transmite por USART0', () => {
    // UCSR0B = 0xC1 (TXEN0 = bit 3), UDR0 = 0xC6.
    const runner = new AvrRunner(
      build(`
        ldi r16, 0x08
        sts 0xC1, r16
        ldi r16, 0x48   ; 'H'
        sts 0xC6, r16
        ldi r16, 0x69   ; 'i'
        sts 0xC6, r16
      fin:
        rjmp fin
      `),
    );
    runner.runCycles(200);
    expect(runner.serialOutput).toBe('Hi');
  });
});

describe('entradas', () => {
  it('un pin de entrada refleja lo que le impone el exterior', () => {
    // PD2 como entrada; el firmware copia PIND2 a PB5.
    const runner = new AvrRunner(
      build(`
        ldi r16, 0x20
        out 0x04, r16    ; DDRB = 0x20
        ldi r17, 0x00
        out 0x0A, r17    ; DDRD = 0, entradas
      bucle:
        sbic 0x09, 2     ; salta si PIND2 está a cero
        out 0x05, r16
        sbis 0x09, 2
        out 0x05, r17
        rjmp bucle
      `),
    );
    runner.runCycles(200);
    expect(runner.isHigh(13)).toBe(false);
    runner.setPin(2, true);
    runner.runCycles(200);
    expect(runner.isHigh(13)).toBe(true);
    runner.setPin(2, false);
    runner.runCycles(200);
    expect(runner.isHigh(13)).toBe(false);
  });

  it('el convertidor analógico lee la tensión impuesta', () => {
    const runner = new AvrRunner(
      build(`
        ldi r16, 0x40
        sts 0x7C, r16   ; ADMUX: referencia AVCC, canal 0
        ldi r16, 0x87
        sts 0x7A, r16   ; ADCSRA: ADEN + preescala 128
        ldi r16, 0xC7
        sts 0x7A, r16   ; ADSC: iniciar conversión
      espera:
        lds r17, 0x7A
        sbrc r17, 6
        rjmp espera
        lds r18, 0x78   ; ADCL
        lds r19, 0x79   ; ADCH
      fin:
        rjmp fin
      `),
    );
    runner.setAnalogVoltage(0, 2.5);
    runner.runCycles(50_000);
    const lectura = runner.cpu.data[18] | (runner.cpu.data[19] << 8);
    // 2,5 V sobre una referencia de 5 V y 10 bits: 512 cuentas.
    expect(lectura).toBeGreaterThan(505);
    expect(lectura).toBeLessThan(519);
  });

  it('rechaza un canal analógico que no existe', () => {
    const runner = new AvrRunner(build('fin: rjmp fin'));
    expect(() => runner.setAnalogVoltage(9, 1)).toThrow(/no tiene el canal/);
  });
});
