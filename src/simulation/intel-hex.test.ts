import { describe, expect, it } from 'vitest';
import { assemble } from 'avr8js/dist/esm/utils/assembler';

import { AvrRunner } from './avr-runner';
import { HexParseError, parseIntelHex, toProgramMemory } from './intel-hex';

/** Construye un registro Intel HEX con su checksum bien calculado. */
function record(type: number, address: number, data: number[]): string {
  const head = [data.length, (address >> 8) & 0xff, address & 0xff, type];
  const all = [...head, ...data];
  const sum = all.reduce((total, b) => (total + b) & 0xff, 0);
  const checksum = (0x100 - sum) & 0xff;
  return `:${[...all, checksum].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
}

const EOF_RECORD = ':00000001FF';

describe('lectura de Intel HEX', () => {
  it('lee un archivo correcto', () => {
    const hex = [record(0, 0, [0x00, 0xe2, 0x04, 0xb9]), EOF_RECORD].join('\n');
    const program = parseIntelHex(hex);
    expect([...program.bytes.subarray(0, 4)]).toEqual([0x00, 0xe2, 0x04, 0xb9]);
    expect(program.usedBytes).toBe(4);
    expect(program.recordCount).toBe(2);
  });

  it('respeta la dirección de cada registro', () => {
    const hex = [record(0, 0x10, [0xaa, 0xbb]), EOF_RECORD].join('\n');
    const program = parseIntelHex(hex);
    expect(program.bytes[0x10]).toBe(0xaa);
    expect(program.bytes[0x11]).toBe(0xbb);
    expect(program.bytes[0x00]).toBe(0);
    expect(program.usedBytes).toBe(0x12);
  });

  it('rechaza un checksum incorrecto en vez de cargar basura', () => {
    const bueno = record(0, 0, [0x01, 0x02]);
    const malo = `${bueno.slice(0, -2)}00`;
    expect(() => parseIntelHex([malo, EOF_RECORD].join('\n'))).toThrow(HexParseError);
    expect(() => parseIntelHex([malo, EOF_RECORD].join('\n'))).toThrow(/corrupto/);
  });

  it('rechaza un archivo truncado, que es el fallo más silencioso', () => {
    const hex = record(0, 0, [0x01, 0x02]);
    expect(() => parseIntelHex(hex)).toThrow(/sin registro de fin|truncado/);
  });

  it('rechaza contenido después del fin de archivo', () => {
    const hex = [record(0, 0, [0x01, 0x02]), EOF_RECORD, record(0, 8, [0xff, 0xff])].join('\n');
    expect(() => parseIntelHex(hex)).toThrow(/después del registro de fin/);
  });

  it('rechaza una longitud que no coincide con los datos', () => {
    // Se declaran 4 bytes pero solo se envían 2.
    const all = [4, 0, 0, 0, 0x01, 0x02];
    const sum = all.reduce((t, b) => (t + b) & 0xff, 0);
    const hex = `:${[...all, (0x100 - sum) & 0xff].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    expect(() => parseIntelHex([hex, EOF_RECORD].join('\n'))).toThrow(/declara 4 bytes/);
  });

  it('rechaza un tipo de registro desconocido', () => {
    expect(() => parseIntelHex([record(0x09, 0, []), EOF_RECORD].join('\n'))).toThrow(
      /tipo de registro desconocido/,
    );
  });

  it('rechaza lo que no es hexadecimal y lo que no empieza por dos puntos', () => {
    expect(() => parseIntelHex([':0200000Z0102F7', EOF_RECORD].join('\n'))).toThrow(/hexadecimales/);
    expect(() => parseIntelHex(['0200000001020F', EOF_RECORD].join('\n'))).toThrow(/empezar por/);
  });

  it('no deja escribir fuera de la memoria de programa', () => {
    const hex = [record(0, 0xfffe, [0x01, 0x02, 0x03, 0x04]), EOF_RECORD].join('\n');
    expect(() => parseIntelHex(hex, 0x10000)).toThrow(/fuera de los/);
  });

  it('rechaza un archivo sin un solo byte de programa', () => {
    expect(() => parseIntelHex(EOF_RECORD)).toThrow(/ningún byte de programa/);
  });

  it('dice en qué línea está el problema', () => {
    const hex = [record(0, 0, [0x01]), 'basura', EOF_RECORD].join('\n');
    try {
      parseIntelHex(hex);
      expect.unreachable('debería haber lanzado');
    } catch (error) {
      expect((error as HexParseError).line).toBe(2);
    }
  });

  it('interpreta la dirección de arranque de tipo 03 como CS:IP', () => {
    // Registros reales de los gestores de arranque de Arduino.
    // optiboot ATmega328P: CS=0x0000 IP=0x7E00 -> 0x7E00.
    const optiboot = parseIntelHex(
      [':04000003 00007E00 7B'.replace(/ /g, ''), record(0, 0, [0x01, 0x02]), EOF_RECORD].join('\n'),
    );
    expect(optiboot.startAddress).toBe(0x7e00);
    // stk500v2 ATmega2560: CS=0x3000 IP=0xE000 -> 0x3E000, no 0x30000000.
    const mega = parseIntelHex(
      [':04000003 3000E000 E9'.replace(/ /g, ''), record(0, 0, [0x01, 0x02]), EOF_RECORD].join('\n'),
    );
    expect(mega.startAddress).toBe(0x3e000);
    expect(mega.startAddress).not.toBe(0x30000000);
  });

  it('aplica la dirección lineal extendida', () => {
    const hex = [record(0x04, 0, [0x00, 0x00]), record(0, 4, [0x7f]), EOF_RECORD].join('\n');
    expect(parseIntelHex(hex).bytes[4]).toBe(0x7f);
  });
});

describe('del .hex a la ejecución', () => {
  it('un programa serializado a HEX se ejecuta igual que el original', () => {
    const source = `
      ldi r16, 0x20
      ldi r17, 0x00
      out 0x04, r16
    bucle:
      out 0x05, r16
      out 0x05, r17
      rjmp bucle
    `;
    const { bytes, errors } = assemble(source);
    expect(errors).toEqual([]);

    const hex = [record(0, 0, [...bytes]), EOF_RECORD].join('\n');
    const program = parseIntelHex(hex);

    const directo = new AvrRunner(new Uint16Array(bytes.buffer, 0, bytes.length / 2), {
      watchPins: [13],
    });
    const desdeHex = new AvrRunner(toProgramMemory(program), { watchPins: [13] });
    directo.runCycles(400);
    desdeHex.runCycles(400);

    expect(desdeHex.pinChanges).toEqual(directo.pinChanges);
    expect(desdeHex.pinChanges.length).toBeGreaterThan(50);
  });
});
