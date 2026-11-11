import { describe, expect, it } from 'vitest';

import type { ComponentDefinition } from '../domain/types';
import { buildDraft, describePackage, orderPins } from './component-draft';
import { analyze, type DetectedPin } from './image-analysis';
import { dipImage } from './synthetic';

const pieza = (
  id: string, reference: string, name: string, pins: string[],
): ComponentDefinition => ({
  id, name, manufacturer: 'Generic', reference, category: 'microcontrollers',
  description: '', operatingVoltage: null, interfaces: [],
  pins: pins.map((n) => ({ name: n, type: 'Signal' })),
  compatibleBoards: [], implementation: 'visual',
});

const CAT = [
  pieza('oa-lm393', 'LM393', 'Comparador LM393',
    ['OUT1', 'IN1-', 'IN1+', 'GND', 'IN2+', 'IN2-', 'OUT2', 'VCC']),
  pieza('rtc-ds3231', 'DS3231', 'RTC DS3231',
    ['32K', 'SQW', 'RST', 'N.C.', 'N.C.', 'N.C.', 'N.C.', 'GND',
      'VCC', 'N.C.', 'N.C.', 'N.C.', 'VBAT', 'SDA', 'SCL', 'N.C.']),
];

const DIP8 = () => analyze(dipImage({ pinsPerRow: 4, width: 320, height: 200 }));

describe('describir el encapsulado', () => {
  it('reconoce una doble hilera', () => {
    expect(describePackage(DIP8().pins)).toBe('doble hilera, 8 patas');
  });

  it('no describe nada cuando no hay patas', () => {
    expect(describePackage([])).toBeNull();
  });

  it('cuenta los lados cuando las patas rodean la pieza', () => {
    const p = (side: DetectedPin['side']): DetectedPin => ({ side, position: 0.5, widthPx: 3 });
    expect(describePackage([p('top'), p('bottom'), p('left'), p('right')]))
      .toMatch(/4 lados/);
  });
});

describe('orden de numeración', () => {
  it('baja por un lado y vuelve por el otro', () => {
    const p = (side: DetectedPin['side'], position: number): DetectedPin => ({
      side, position, widthPx: 3,
    });
    const orden = orderPins([
      p('left', 0), p('left', 1), p('right', 0), p('right', 1),
    ]);
    // Izquierda de arriba abajo, luego derecha de abajo arriba.
    expect(orden.map((o) => `${o.side}${o.position}`))
      .toEqual(['left0', 'left1', 'right1', 'right0']);
  });
});

describe('pieza identificada por el marcaje', () => {
  it('el patillaje sale del catálogo, no de la foto', () => {
    const d = buildDraft(DIP8(), 'TI LM393 N 0421', CAT);
    expect(d.source).toBe('catalog');
    expect(d.componentId).toBe('oa-lm393');
    expect(d.pins.map((p) => p.name)).toEqual(
      ['OUT1', 'IN1-', 'IN1+', 'GND', 'IN2+', 'IN2-', 'OUT2', 'VCC']);
  });

  it('nunca da por situada la pata 1 sin ver la muesca', () => {
    const d = buildDraft(DIP8(), 'LM393', CAT);
    expect(d.pinOneLocated).toBe(false);
    expect(d.pending.join(' ')).toMatch(/pata 1/i);
  });
});

describe('contradicción entre lo leído y lo medido', () => {
  it('no elige por el usuario: lo declara', () => {
    // El marcaje dice DS3231 (16 patas) y la foto muestra 8.
    const d = buildDraft(DIP8(), 'MAXIM DS3231', CAT);
    expect(d.conflicts).toHaveLength(1);
    expect(d.conflicts[0]).toMatch(/16 patas/);
    expect(d.conflicts[0]).toMatch(/se han contado 8/);
  });

  it('con contradicción NO se usa el patillaje del catálogo', () => {
    const d = buildDraft(DIP8(), 'MAXIM DS3231', CAT);
    expect(d.source).toBe('measured');
    expect(d.componentId).toBeNull();
    expect(d.pins.every((p) => p.name === null)).toBe(true);
  });
});

describe('pieza sin identificar', () => {
  it('entrega la forma medida y los nombres en null', () => {
    const d = buildDraft(DIP8(), '', CAT);
    expect(d.source).toBe('measured');
    expect(d.pinCount).toBe(8);
    expect(d.pins).toHaveLength(8);
    // Lo esencial: NO se inventa qué hace cada pata.
    expect(d.pins.every((p) => p.name === null && p.type === null)).toBe(true);
    expect(d.packageGuess).toBe('doble hilera, 8 patas');
  });

  it('las patas van numeradas de 1 a N sin huecos', () => {
    const d = buildDraft(DIP8(), '', CAT);
    expect(d.pins.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('dice que falta el marcaje para poder identificarla', () => {
    expect(buildDraft(DIP8(), '', CAT).pending.join(' ')).toMatch(/teclee/i);
  });

  it('un marcaje desconocido deja la pieza sin identificar, no mal identificada', () => {
    const d = buildDraft(DIP8(), 'LM338T 0421', CAT);
    expect(d.componentId).toBeNull();
    expect(d.candidates).toEqual([]);
  });

  it('con varias piezas posibles pide que se elija', () => {
    const d = buildDraft(DIP8(), 'LM393 DS3231', CAT);
    expect(d.pending.join(' ')).toMatch(/elija cual es/i);
    expect(d.componentId).toBeNull();
  });
});

describe('sin foto aprovechable', () => {
  const vacio = analyze(dipImage({ pinsPerRow: 4, bodyGray: 235, backgroundGray: 235 }));

  it('arrastra los avisos del análisis', () => {
    expect(buildDraft(vacio, '', CAT).warnings.length).toBeGreaterThan(0);
  });

  it('si la pieza se identifica, dice que la posición no viene de la imagen', () => {
    const d = buildDraft(vacio, 'LM393', CAT);
    expect(d.source).toBe('catalog');
    expect(d.pending.join(' ')).toMatch(/no se han podido medir/i);
  });
});
