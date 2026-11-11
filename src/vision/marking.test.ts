import { describe, expect, it } from 'vitest';

import { componentCatalog } from '../domain/catalog';
import type { ComponentDefinition } from '../domain/types';
import { collapseGlyphs, normalizeToken, readMarking, splitMarking } from './marking';

const pieza = (
  id: string, reference: string, name: string, pins: number,
): ComponentDefinition => ({
  id, name, manufacturer: 'Generic', reference, category: 'microcontrollers',
  description: '', operatingVoltage: null, interfaces: [],
  pins: Array.from({ length: pins }, (_, i) => ({ name: `P${i + 1}`, type: 'Signal' })),
  compatibleBoards: [], implementation: 'visual',
});

const CAT = [
  pieza('rtc-ds3231', 'DS3231', 'RTC DS3231', 16),
  pieza('imu-mpu6050', 'MPU6050', 'IMU MPU6050', 8),
  pieza('oa-lm393', 'LM393', 'Comparador LM393', 8),
];

describe('separar el marcaje', () => {
  it('se queda con la referencia y aparta lo demás', () => {
    // Un marcaje real de ATmega328P, tal como viene impreso.
    const r = splitMarking('ATMEL\nATMEGA328P\n-PU\n1735');
    expect(r.tokens).toEqual(['ATMEGA328P']);
    const motivos = r.discarded.map((d) => d.why).join(' ');
    expect(motivos).toMatch(/fabricante/i);
    expect(motivos).toMatch(/sufijo de encapsulado/i);
    expect(motivos).toMatch(/lote o de fecha/i);
  });

  it('nada se descarta en silencio', () => {
    const r = splitMarking('TI LM393 N 0421');
    expect(r.tokens.concat(r.discarded.map((d) => d.token))).toHaveLength(4);
    for (const d of r.discarded) expect(d.why.length).toBeGreaterThan(10);
  });

  it('no repite un trozo que aparece dos veces', () => {
    expect(splitMarking('DS3231 ds3231').tokens).toEqual(['DS3231']);
  });

  it('normaliza puntos, guiones y minúsculas', () => {
    expect(normalizeToken('ds-32.31 sn')).toBe('DS3231SN');
  });
});

describe('identificar la pieza', () => {
  it('reconoce una referencia exacta', () => {
    const r = readMarking('MAXIM DS3231 1920', CAT);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].componentId).toBe('rtc-ds3231');
    expect(r.matches[0].kind).toBe('exact');
  });

  it('reconoce la referencia con el sufijo pegado', () => {
    const r = readMarking('DS3231SN', CAT);
    expect(r.matches[0].componentId).toBe('rtc-ds3231');
    expect(r.matches[0].kind).toBe('suffix');
    expect(r.matches[0].reason).toMatch(/sufijo/i);
  });

  it('resuelve la confusión del cero con la O, pero avisa', () => {
    const r = readMarking('MPU6O5O', CAT);
    expect(r.matches[0].componentId).toBe('imu-mpu6050');
    expect(r.matches[0].kind).toBe('glyph');
    expect(r.matches[0].reason).toMatch(/CONFIRMELO/);
  });

  it('NO devuelve la pieza más parecida cuando no reconoce nada', () => {
    // Lo importante de todo el módulo: montar un LM338 creyendo que es un
    // LM358 destruye el circuito. Mejor no proponer nada.
    const r = readMarking('LM338T', CAT);
    expect(r.matches).toEqual([]);
    expect(r.tokens).toEqual(['LM338T']);
  });

  it('un marcaje ilegible no produce ninguna propuesta', () => {
    expect(readMarking('.. -- ##', CAT).matches).toEqual([]);
  });

  it('lo firme va antes que lo dudoso', () => {
    const r = readMarking('LM393 MPU6O5O', CAT);
    expect(r.matches[0].kind).toBe('exact');
    expect(r.matches[r.matches.length - 1].kind).toBe('glyph');
  });

  it('funciona contra el catálogo real de la aplicación', () => {
    const real = componentCatalog[0];
    const r = readMarking(real.reference, componentCatalog);
    expect(r.matches.some((m) => m.componentId === real.id)).toBe(true);
  });
});

describe('colapsar glifos', () => {
  it('une los pares que de verdad se confunden al leer', () => {
    expect(collapseGlyphs('O0')).toBe('00');
    expect(collapseGlyphs('I1L')).toBe('111');
    expect(collapseGlyphs('S5')).toBe('55');
    expect(collapseGlyphs('B8')).toBe('88');
  });

  it('no toca lo que no se confunde', () => {
    expect(collapseGlyphs('AMPX')).toBe('AMPX');
  });
});
