import { describe, expect, it } from 'vitest';

import { MAX_SIDE, scaleToFit } from './load-image';

describe('reducir la foto antes de medirla', () => {
  it('una foto de móvil se reduce al lado máximo', () => {
    expect(scaleToFit(4032, 3024)).toEqual({ width: MAX_SIDE, height: 675 });
  });

  it('conserva la proporción', () => {
    const r = scaleToFit(4000, 1000);
    expect(r.width / r.height).toBeCloseTo(4, 2);
  });

  it('no amplía una imagen pequeña: inventaría detalle que no hay', () => {
    expect(scaleToFit(320, 200)).toEqual({ width: 320, height: 200 });
  });

  it('respeta las fotos verticales', () => {
    const r = scaleToFit(3024, 4032);
    expect(r.height).toBe(MAX_SIDE);
    expect(r.width).toBeLessThan(r.height);
  });

  it('nunca devuelve un lado de cero', () => {
    const r = scaleToFit(10000, 3, 900);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });

  it('no revienta con una imagen vacía', () => {
    expect(scaleToFit(0, 0)).toEqual({ width: 0, height: 0 });
  });
});
