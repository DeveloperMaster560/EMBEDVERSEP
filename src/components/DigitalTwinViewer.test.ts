import { Box3, Line, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { makeIllustrativeBridge } from '../3d/bridgeModel';

describe('illustrative bridge model', () => {
  it('creates a visible bridge with towers, deck, and suspension cables', () => {
    const bridge = makeIllustrativeBridge();
    const bounds = new Box3().setFromObject(bridge);
    const meshes = bridge.children.filter((child) => child instanceof Mesh);
    const cables = bridge.children.filter((child) => child instanceof Line);
    const size = bounds.getSize(new Vector3());

    expect(meshes.length).toBeGreaterThan(20);
    expect(cables).toHaveLength(2);
    expect(size.x).toBeGreaterThan(20);
    expect(size.y).toBeGreaterThan(15);
  });
});
