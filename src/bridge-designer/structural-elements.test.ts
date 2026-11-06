import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';

import { createCableBetween, createStructuralElement } from './scene';

/**
 * Comprueba el cable con la misma matemática que usa el visor: se parte del eje
 * +Y del cilindro, se le aplica la rotación del objeto y se mira si el
 * resultado apunta de un extremo al otro.
 */
function cableDirection(rotation: [number, number, number]): Vector3 {
  const quaternion = new Quaternion().setFromEuler(new Euler(...rotation, 'XYZ'));
  return new Vector3(0, 1, 0).applyQuaternion(quaternion).normalize();
}

describe('createStructuralElement', () => {
  it('crea cada elemento en la colección de estructura y editable', () => {
    for (const element of ['beam', 'column', 'plate', 'brace', 'cable'] as const) {
      const object = createStructuralElement(element);
      expect(object.collection).toBe('Estructura');
      expect(object.role).toBe('structure');
      expect(object.locked).toBe(false);
      expect(object.visible).toBe(true);
      expect(object.dimensions.every((d) => d > 0)).toBe(true);
    }
  });

  it('apoya cada pieza sobre el plano en vez de dejarla medio enterrada', () => {
    for (const element of ['beam', 'column', 'plate', 'brace'] as const) {
      const object = createStructuralElement(element);
      expect(object.position[1]).toBeCloseTo(object.dimensions[1] / 2, 6);
    }
  });

  it('da identificadores distintos a cada pieza', () => {
    const uno = createStructuralElement('beam');
    const otro = createStructuralElement('beam');
    expect(uno.id).not.toBe(otro.id);
  });
});

describe('createCableBetween', () => {
  it('coloca el cable en el punto medio y con la longitud exacta', () => {
    const cable = createCableBetween([0, 0, 0], [0, 10, 0]);
    expect(cable.position).toEqual([0, 5, 0]);
    expect(cable.dimensions[1]).toBeCloseTo(10, 6);
  });

  it('apunta de un extremo al otro en cualquier dirección', () => {
    const casos: [[number, number, number], [number, number, number]][] = [
      [[0, 0, 0], [0, 10, 0]],
      [[0, 0, 0], [10, 0, 0]],
      [[0, 0, 0], [0, 0, 10]],
      [[0, 20, 0], [30, 5, 0]],
      [[-4, 12, 7], [9, 3, -6]],
      [[2, 2, 2], [2, 2, 9]],
    ];
    for (const [from, to] of casos) {
      const cable = createCableBetween(from, to);
      const esperado = new Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
      const obtenido = cableDirection(cable.rotation);
      expect(obtenido.dot(esperado), `dirección errónea entre ${from} y ${to}`).toBeCloseTo(1, 5);
      expect(cable.dimensions[1]).toBeCloseTo(
        Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]),
        6,
      );
    }
  });

  it('respeta el diámetro pedido en las dos caras del cilindro', () => {
    const cable = createCableBetween([0, 0, 0], [0, 6, 0], 0.25);
    expect(cable.dimensions[0]).toBe(0.25);
    expect(cable.dimensions[2]).toBe(0.25);
  });

  it('se niega a crear un cable de longitud cero en vez de dejar una pieza degenerada', () => {
    expect(() => createCableBetween([3, 3, 3], [3, 3, 3])).toThrow(/dos puntos distintos/i);
  });
});
