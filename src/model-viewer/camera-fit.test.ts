/**
 * El encuadre tiene que funcionar con lo que de verdad genera el sistema:
 * un viaducto de 550 m y un edificio de 30, en ventanas de cualquier forma.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MARGIN, clippingPlanes, fitDistance, fitsInView, limitingHalfAngle,
} from './camera-fit';

/** Radio de la esfera que envuelve a una caja de estas dimensiones. */
const radiusOf = (x: number, y: number, z: number) =>
  Math.sqrt(x * x + y * y + z * z) / 2;

// Medidas reales, leídas del GLB que devuelve el generador.
const VIADUCTO = radiusOf(555.3, 135.0, 36.1);
const EDIFICIO = radiusOf(35.8, 32.9, 21.6);
const FOV = 42;

describe('semiángulo que limita el encuadre', () => {
  it('en una ventana apaisada manda la vertical', () => {
    // Horizontal más abierta que vertical: lo que recorta es el alto.
    expect(limitingHalfAngle(FOV, 16 / 9)).toBeCloseTo((FOV * Math.PI) / 360, 10);
  });

  it('en una ventana estrecha manda la horizontal', () => {
    const half = limitingHalfAngle(FOV, 0.5);
    expect(half).toBeLessThan((FOV * Math.PI) / 360);
  });

  it('en una ventana cuadrada los dos coinciden', () => {
    expect(limitingHalfAngle(FOV, 1)).toBeCloseTo((FOV * Math.PI) / 360, 10);
  });
});

describe('el viaducto entra entero', () => {
  /**
   * Es la prueba que justifica el cambio: el cálculo anterior tomaba la
   * dimensión mayor como si el modelo fuese un cubo, y el puente se salía.
   */
  for (const [nombre, aspect] of [
    ['panorámica 21:9', 21 / 9],
    ['apaisada 16:9', 16 / 9],
    ['cuadrada', 1],
    ['vertical 3:4', 0.75],
    ['muy estrecha 1:2', 0.5],
  ] as const) {
    it(`cabe en una ventana ${nombre}`, () => {
      const d = fitDistance(VIADUCTO, FOV, aspect);
      expect(fitsInView(d, VIADUCTO, FOV, aspect)).toBe(true);
    });
  }

  it('una ventana estrecha obliga a alejarse más que una apaisada', () => {
    expect(fitDistance(VIADUCTO, FOV, 0.5))
      .toBeGreaterThan(fitDistance(VIADUCTO, FOV, 16 / 9));
  });

  it('deja aire, no lo pega a los bordes', () => {
    const d = fitDistance(VIADUCTO, FOV, 16 / 9);
    const justo = fitDistance(VIADUCTO, FOV, 16 / 9, 1);
    expect(d / justo).toBeCloseTo(DEFAULT_MARGIN, 10);
  });
});

describe('sirve igual para un edificio', () => {
  it('cabe entero', () => {
    const d = fitDistance(EDIFICIO, FOV, 16 / 9);
    expect(fitsInView(d, EDIFICIO, FOV, 16 / 9)).toBe(true);
  });

  it('la distancia escala con el tamaño, no con la tipología', () => {
    // El puente es ~11 veces mayor que el edificio; la cámara se aleja otro
    // tanto. Nada en el encuadre depende de si es puente o edificio.
    const razon = fitDistance(VIADUCTO, FOV, 16 / 9) / fitDistance(EDIFICIO, FOV, 16 / 9);
    expect(razon).toBeCloseTo(VIADUCTO / EDIFICIO, 6);
  });
});

describe('entradas imposibles no mandan la cámara al infinito', () => {
  it('un modelo sin tamaño no mueve la cámara', () => {
    expect(fitDistance(0, FOV, 16 / 9)).toBe(0);
    expect(fitDistance(Number.NaN, FOV, 16 / 9)).toBe(0);
    expect(fitDistance(-5, FOV, 16 / 9)).toBe(0);
  });

  it('un campo de visión degenerado tampoco', () => {
    expect(fitDistance(VIADUCTO, 0, 16 / 9)).toBe(0);
  });

  it('una ventana de ancho cero no da una distancia infinita', () => {
    expect(Number.isFinite(fitDistance(VIADUCTO, FOV, 0))).toBe(true);
  });
});

describe('planos de recorte', () => {
  it('el viaducto entero queda por delante del plano lejano', () => {
    const d = fitDistance(VIADUCTO, FOV, 16 / 9);
    const { near, far } = clippingPlanes(d, VIADUCTO);
    // La cara más lejana del modelo está a d + radio.
    expect(far).toBeGreaterThan(d + VIADUCTO);
    expect(near).toBeLessThan(d);
    expect(near).toBeGreaterThan(0);
  });

  it('con una pieza pequeña el plano cercano no se la come', () => {
    const { near } = clippingPlanes(4, 0.5);
    expect(near).toBeLessThan(0.1);
  });

  it('el recorte crece con el modelo', () => {
    const grande = clippingPlanes(fitDistance(VIADUCTO, FOV, 1.6), VIADUCTO);
    const chico = clippingPlanes(fitDistance(EDIFICIO, FOV, 1.6), EDIFICIO);
    expect(grande.far).toBeGreaterThan(chico.far);
  });
});
