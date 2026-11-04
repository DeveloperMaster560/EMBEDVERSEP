import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createBridgeGeometry } from './geometry';
import { createPrimitive } from './scene';

describe('bridge designer editable primitive geometry', () => {
  it('creates finite non-empty Three.js geometries for every supported primitive', () => {
    for (const kind of ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus'] as const) {
      const geometry = createBridgeGeometry(createPrimitive(kind));
      geometry.computeBoundingBox();
      const size = geometry.boundingBox?.getSize(new Vector3());

      expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(size?.toArray().every(Number.isFinite)).toBe(true);
      geometry.dispose();
    }
  });
});
