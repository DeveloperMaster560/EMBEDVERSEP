import { describe, expect, it } from 'vitest';

import { deckReferenceFromBox, vehicleTransform, type Box } from './traffic-placement';

const box = (
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): Box => ({ min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } });

/**
 * Caja real de la carpeta de rodadura del Viaducto de la Novena, leída del GLB
 * que devuelve el generador el 10 de noviembre de 2026.
 *
 * Es Z ARRIBA: el generador exporta con trimesh y no mete ninguna rotación en
 * la raíz, aunque glTF diga que Y va arriba. Esta caja es la que descubrió que
 * suponer el eje vertical estaba mal, así que se conserva tal cual.
 */
const VIADUCTO = box(0, -3.8, 7.0, 550, 3.8, 7.07);

describe('medida del tablero del viaducto real', () => {
  const reference = deckReferenceFromBox(VIADUCTO, 'TAB-CAR');

  it('deduce los tres ejes sin suponer cuál va hacia arriba', () => {
    expect(reference).not.toBeNull();
    expect(reference!.longitudinal).toBe('x');
    expect(reference!.transverse).toBe('y');
    // Z es el vertical en este modelo, no Y.
    expect(reference!.vertical).toBe('z');
  });

  it('da las dimensiones correctas, no el espesor por ancho', () => {
    expect(reference!.lengthM).toBeCloseTo(550, 6);
    expect(reference!.widthM).toBeCloseTo(7.6, 6);
    // El error anterior daba 0,07 m de ancho: el espesor de la carpeta.
    expect(reference!.thicknessM).toBeCloseTo(0.07, 6);
    expect(reference!.widthM).toBeGreaterThan(reference!.thicknessM * 10);
  });

  it('sitúa la superficie en la cara de arriba de la carpeta', () => {
    expect(reference!.surfaceLevel).toBeCloseTo(7.07, 6);
  });
});

describe('medida con otros convenios de exportación', () => {
  it('reconoce un tablero con Y arriba y largo en X', () => {
    const reference = deckReferenceFromBox(box(-275, 10, -9, 275, 10.07, 9), 'TAB-CAR');
    expect(reference!.longitudinal).toBe('x');
    expect(reference!.transverse).toBe('z');
    expect(reference!.vertical).toBe('y');
    expect(reference!.lengthM).toBeCloseTo(550, 6);
    expect(reference!.widthM).toBeCloseTo(18, 6);
    expect(reference!.surfaceLevel).toBeCloseTo(10.07, 6);
  });

  it('reconoce un tablero con Y arriba y largo en Z', () => {
    const reference = deckReferenceFromBox(box(-9, 10, -275, 9, 10.07, 275), 'TAB-CAR');
    expect(reference!.longitudinal).toBe('z');
    expect(reference!.transverse).toBe('x');
    expect(reference!.vertical).toBe('y');
  });

  it('desplaza el centro transversal si el tablero no pasa por el origen', () => {
    const reference = deckReferenceFromBox(box(0, 100, 7, 550, 118, 7.07), 'TAB-CAR');
    expect(reference!.transverseCenter).toBeCloseTo(109, 6);
    expect(reference!.startAlong).toBeCloseTo(0, 6);
  });
});

describe('cajas que no se deben aceptar', () => {
  it('descarta una caja degenerada', () => {
    expect(deckReferenceFromBox(box(0, 0, 0, 0, 0, 0), 'x')).toBeNull();
  });

  it('descarta extensiones no finitas', () => {
    expect(deckReferenceFromBox(
      box(Number.POSITIVE_INFINITY, 0, 0, Number.NEGATIVE_INFINITY, 1, 1), 'x',
    )).toBeNull();
  });

  it('descarta un cubo, que no es una calzada', () => {
    // Sin una proporción de losa no hay forma de saber qué eje es cuál.
    expect(deckReferenceFromBox(box(0, 0, 0, 10, 10, 10), 'x')).toBeNull();
  });

  it('descarta una losa cuadrada en planta', () => {
    expect(deckReferenceFromBox(box(0, 0, 0, 20, 20, 0.1), 'x')).toBeNull();
  });
});

describe('colocación de un vehículo en el viaducto real', () => {
  const reference = deckReferenceFromBox(VIADUCTO, 'TAB-CAR')!;

  it('avanza a lo largo del tablero y se separa en el eje transversal', () => {
    const placement = vehicleTransform(reference, 100, -1.75, 1.5);
    // Longitudinal es X: la abscisa 100 cae en x = 0 + 100.
    expect(placement.position[0]).toBeCloseTo(100, 6);
    // Transversal es Y: el carril se separa del centro, que está en 0.
    expect(placement.position[1]).toBeCloseTo(-1.75, 6);
    // Vertical es Z: apoyado sobre 7,07 más media altura.
    expect(placement.position[2]).toBeCloseTo(7.07 + 0.75, 6);
  });

  it('orienta el vehículo con el largo a lo largo y el alto hacia arriba', () => {
    const { basis } = vehicleTransform(reference, 0, 0, 1.5);
    expect(basis.length).toEqual([1, 0, 0]);
    // El alto del vehículo apunta en Z, que es el vertical de este modelo.
    expect(basis.height).toEqual([0, 0, 1]);
  });

  it('la base es derecha, para no dibujar los vehículos reflejados', () => {
    const { basis } = vehicleTransform(reference, 0, 0, 1.5);
    const [lx, ly, lz] = basis.length;
    const [hx, hy, hz] = basis.height;
    const [wx, wy, wz] = basis.width;
    const determinant =
      lx * (hy * wz - hz * wy) - ly * (hx * wz - hz * wx) + lz * (hx * wy - hy * wx);
    expect(determinant).toBeGreaterThan(0);
  });

  it('los extremos caen donde acaba la geometría', () => {
    expect(vehicleTransform(reference, 0, 0, 1.5).position[0]).toBeCloseTo(0, 6);
    expect(vehicleTransform(reference, 550, 0, 1.5).position[0]).toBeCloseTo(550, 6);
  });

  it('un bus se apoya igual que un coche, no se hunde', () => {
    const bus = vehicleTransform(reference, 10, 0, 3.2);
    expect(bus.position[2]).toBeCloseTo(7.07 + 1.6, 6);
  });
});

describe('colocación con Y arriba', () => {
  const reference = deckReferenceFromBox(box(-275, 10, -9, 275, 10.07, 9), 'TAB-CAR')!;

  it('coloca y orienta igual de bien con el otro convenio', () => {
    const placement = vehicleTransform(reference, 275, 3.5, 1.5);
    expect(placement.position[0]).toBeCloseTo(0, 6);
    expect(placement.position[1]).toBeCloseTo(10.07 + 0.75, 6);
    expect(placement.position[2]).toBeCloseTo(3.5, 6);
    expect(placement.basis.height).toEqual([0, 1, 0]);
  });
});
