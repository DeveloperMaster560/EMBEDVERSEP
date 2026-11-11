import { describe, expect, it } from 'vitest';

import {
  analyze, coreBody, darkMask, largestRegion, luminance, otsuThreshold,
} from './image-analysis';
import { blankImage, dipImage, fillRect } from './synthetic';

describe('luminancia y umbral', () => {
  it('el negro y el blanco quedan en los extremos', () => {
    expect(luminance(0, 0, 0)).toBe(0);
    expect(Math.round(luminance(255, 255, 255))).toBe(255);
  });

  it('el verde pesa más que el azul, como en la visión humana', () => {
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(0, 0, 255));
  });

  it('el umbral separa la pieza del fondo, con el cuerpo dentro', () => {
    const img = dipImage({ pinsPerRow: 4 });
    const t = otsuThreshold(img);
    // El cuerpo vale 40 y el fondo 235: el umbral debe dejar el cuerpo en la
    // clase oscura (de ahi el >=, no >) y el fondo fuera.
    expect(t).toBeGreaterThanOrEqual(40);
    expect(t).toBeLessThan(235);
  });

  it('un cuerpo cuyo tono coincide con el umbral NO se pierde', () => {
    // Esto fallaba: la mascara salia vacia salvo por suerte de coma flotante.
    const img = dipImage({ pinsPerRow: 4 });
    const t = otsuThreshold(img);
    const mask = darkMask(img, t);
    expect(mask.reduce<number>((a, v) => a + v, 0)).toBeGreaterThan(100);
  });

  it('una imagen de un solo tono no revienta', () => {
    expect(() => otsuThreshold(blankImage(32, 32, 128))).not.toThrow();
  });
});

describe('aislar la pieza del fondo', () => {
  it('la mancha más grande es el cuerpo, no un reflejo suelto', () => {
    const img = dipImage({ pinsPerRow: 4 });
    // Una mota oscura en una esquina: no debe confundirse con la pieza.
    fillRect(img, 2, 2, 6, 6, 20);
    const mask = darkMask(img, otsuThreshold(img));
    const region = largestRegion(mask, img.width, img.height);
    expect(region).not.toBeNull();
    expect(region!.box.x0).toBeGreaterThan(10);
  });

  it('separa el cuerpo de las patas', () => {
    const img = dipImage({ pinsPerRow: 4 });
    const mask = darkMask(img, otsuThreshold(img));
    const region = largestRegion(mask, img.width, img.height)!;
    const core = coreBody(mask, img.width, region.box);
    // El contorno exterior incluye las patas; el cuerpo, no. Debe ser más bajo.
    expect(core.y1 - core.y0).toBeLessThan(region.box.y1 - region.box.y0);
    expect(core.y0).toBeGreaterThan(region.box.y0);
  });
});

describe('contar patas', () => {
  for (const n of [4, 7, 10, 14]) {
    it(`cuenta ${n} patas por hilera en un DIP-${n * 2}`, () => {
      const r = analyze(dipImage({ pinsPerRow: n, width: 320, height: 200 }));
      expect(r.pins.filter((p) => p.side === 'top')).toHaveLength(n);
      expect(r.pins.filter((p) => p.side === 'bottom')).toHaveLength(n);
      expect(r.warnings).toEqual([]);
    });
  }

  it('las cuenta igual si la foto está girada 90°', () => {
    const r = analyze(dipImage({
      pinsPerRow: 7, orientation: 'vertical', width: 200, height: 320,
    }));
    expect(r.pins.filter((p) => p.side === 'left')).toHaveLength(7);
    expect(r.pins.filter((p) => p.side === 'right')).toHaveLength(7);
  });

  it('las patas salen ordenadas a lo largo del lado', () => {
    const r = analyze(dipImage({ pinsPerRow: 6, width: 320, height: 200 }));
    const arriba = r.pins.filter((p) => p.side === 'top').map((p) => p.position);
    expect(arriba).toEqual([...arriba].sort((a, b) => a - b));
    expect(arriba[0]).toBeLessThan(0.2);
    expect(arriba[arriba.length - 1]).toBeGreaterThan(0.8);
  });
});

describe('avisar en vez de afirmar', () => {
  it('no inventa una pieza donde no hay nada', () => {
    const r = analyze(blankImage(200, 200));
    expect(r.body).toBeNull();
    expect(r.pins).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/no se distingue/i);
  });

  it('avisa si el recuento no cuadra entre las dos hileras', () => {
    // Una pata perdida por sombra o desenfoque: pasa en fotos reales.
    const r = analyze(dipImage({ pinsPerRow: 8, omitPin: 3, width: 320, height: 200 }));
    expect(r.warnings.join(' ')).toMatch(/revise el recuento/i);
  });

  it('avisa si parece que se ha tomado el fondo por la pieza', () => {
    const img = blankImage(200, 200, 30);
    fillRect(img, 80, 80, 120, 120, 240);
    const r = analyze(img);
    expect(r.warnings.join(' ')).toMatch(/fondo/i);
  });

  it('lo detecta por los bordes, no por el porcentaje de ocupación', () => {
    // El fondo rodea la pieza y llega a los cuatro bordes aunque solo ocupe
    // tres cuartos del encuadre: un umbral de ocupación se lo perdía.
    const img = blankImage(300, 200, 35);
    fillRect(img, 24, 74, 276, 126, 230);
    const r = analyze(img);
    expect(r.warnings.join(' ')).toMatch(/cuatro bordes/i);
  });

  it('una pieza que se ve entera NO dispara ese aviso', () => {
    const r = analyze(dipImage({ pinsPerRow: 5, width: 320, height: 200 }));
    expect(r.warnings.join(' ')).not.toMatch(/cuatro bordes/i);
  });

  it('rechaza una imagen minúscula sin fingir una medida', () => {
    const r = analyze(blankImage(8, 8));
    expect(r.body).toBeNull();
    expect(r.warnings).toHaveLength(1);
  });

  it('avisa cuando no detecta ninguna pata', () => {
    // Un rectángulo liso: un módulo sin tira de pines soldada.
    const img = blankImage(200, 200);
    fillRect(img, 60, 70, 140, 130, 40);
    const r = analyze(img);
    expect(r.warnings.join(' ')).toMatch(/ninguna pata/i);
  });
});
