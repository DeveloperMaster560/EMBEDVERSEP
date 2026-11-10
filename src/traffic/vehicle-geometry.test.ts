/**
 * La silueta de un vehículo no puede desmentir a la simulación.
 *
 * El modelo IDM calcula los huecos entre vehículos con la longitud declarada
 * de cada clase. Si la malla fuese más larga, se verían coches solapados
 * donde la simulación afirma que hay separación; si fuese más corta, huecos
 * que no existen. Por eso aquí se mide la caja envolvente de cada clase y se
 * exige que coincida con lo declarado.
 */

import { describe, expect, it } from 'vitest';

import { createVehicleGeometry } from './vehicle-geometry';
import { VEHICLE_CLASS_IDS, VEHICLE_CLASSES } from './vehicles';

describe('geometría de los vehículos', () => {
  for (const id of VEHICLE_CLASS_IDS) {
    const vehicleClass = VEHICLE_CLASSES[id];
    describe(vehicleClass.id, () => {
      const geometry = createVehicleGeometry(vehicleClass);
      const box = geometry.boundingBox!;

      it('mide exactamente lo que declara su clase', () => {
        expect(box).not.toBeNull();
        expect(box.max.x - box.min.x).toBeCloseTo(vehicleClass.lengthM, 5);
        expect(box.max.y - box.min.y).toBeCloseTo(vehicleClass.heightM, 5);
        expect(box.max.z - box.min.z).toBeCloseTo(vehicleClass.widthM, 5);
      });

      it('apoya en la rasante y queda centrado, como la caja que sustituye', () => {
        // El colocador sitúa el centro a media altura sobre la calzada: si la
        // malla no estuviera centrada, los vehículos flotarían o se hundirían.
        expect(box.min.y).toBeCloseTo(-vehicleClass.heightM / 2, 5);
        expect(box.max.y).toBeCloseTo(vehicleClass.heightM / 2, 5);
        expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
        expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 5);
      });

      it('lleva color por vértice, que es lo que distingue ruedas y cristales', () => {
        const colores = geometry.getAttribute('color');
        expect(colores).toBeDefined();
        expect(colores.count).toBe(geometry.getAttribute('position').count);
        // Si todo fuera del mismo color, no habría silueta que leer.
        const distintos = new Set<string>();
        for (let i = 0; i < colores.count; i += 1) {
          distintos.add(`${colores.getX(i).toFixed(3)},${colores.getY(i).toFixed(3)},${colores.getZ(i).toFixed(3)}`);
        }
        expect(distintos.size).toBeGreaterThan(2);
      });

      it('no es una caja: tiene piezas de sobra para leerse', () => {
        // Una caja sola son 24 vértices. Cualquier silueta reconocible lleva
        // bastantes más.
        expect(geometry.getAttribute('position').count).toBeGreaterThan(100);
      });
    });
  }

  it('un bus y una moto ya no se distinguen solo por el tamaño', () => {
    const bus = createVehicleGeometry(VEHICLE_CLASSES.bus);
    const moto = createVehicleGeometry(VEHICLE_CLASSES.motocicleta);
    // El bus lleva seis ruedas y la moto dos: la diferencia tiene que notarse
    // en la malla, no solo en la escala.
    expect(bus.getAttribute('position').count)
      .toBeGreaterThan(moto.getAttribute('position').count);
  });
});
