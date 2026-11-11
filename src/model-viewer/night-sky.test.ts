import { describe, expect, it } from 'vitest';

import { DAY, NIGHT, mixHex, skyFor } from './night-sky';

describe('luz de la escena', () => {
  it('a pleno día deja la iluminación que había', () => {
    const s = skyFor(1);
    expect(s.key).toBeCloseTo(DAY.key, 6);
    expect(s.hemisphere).toBeCloseTo(DAY.hemisphere, 6);
    expect(s.background).toBe(DAY.background);
  });

  it('de noche cerrada baja a la escena nocturna', () => {
    const s = skyFor(0);
    expect(s.key).toBeCloseTo(NIGHT.key, 6);
    expect(s.background).toBe(NIGHT.background);
  });

  /**
   * Si de noche se apagara todo del todo, no se sabría si el alumbrado está
   * apagado o si el modelo ha desaparecido.
   */
  it('de noche queda algo de luz, para que el puente siga ahí', () => {
    const s = skyFor(0);
    expect(s.hemisphere).toBeGreaterThan(0);
    expect(s.key).toBeGreaterThan(0);
  });

  it('más luz nunca oscurece la escena', () => {
    let anterior = skyFor(0).key;
    for (const nivel of [0.1, 0.25, 0.4, 0.6, 0.8, 1]) {
      const actual = skyFor(nivel).key;
      expect(actual).toBeGreaterThan(anterior);
      anterior = actual;
    }
  });

  it('a media carrera ya está oscuro, no a medio camino', () => {
    // Es lo que permite ver el alumbrado sin llevar el deslizador al extremo.
    const medio = skyFor(0.5);
    const mitadLineal = (NIGHT.key + DAY.key) / 2;
    expect(medio.key).toBeLessThan(mitadLineal);
  });

  it('valores imposibles no rompen la escena', () => {
    expect(skyFor(-3).key).toBeCloseTo(NIGHT.key, 6);
    expect(skyFor(9).key).toBeCloseTo(DAY.key, 6);
    expect(skyFor(Number.NaN).key).toBeCloseTo(DAY.key, 6);
  });
});

describe('mezcla de colores', () => {
  it('en los extremos devuelve cada color', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('a la mitad queda en medio', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
