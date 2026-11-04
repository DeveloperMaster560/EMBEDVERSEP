import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { BridgeObject } from './types';

export function createBridgeGeometry(object: BridgeObject): BufferGeometry {
  const [width, height, depth] = object.dimensions;
  switch (object.kind) {
    case 'box': return new BoxGeometry(width, height, depth);
    case 'sphere': {
      const geometry = new SphereGeometry(0.5, 28, 18);
      geometry.scale(width, height, depth);
      return geometry;
    }
    case 'cylinder': return new CylinderGeometry(width / 2, depth / 2, height, 16);
    case 'cone': {
      const geometry = new ConeGeometry(width / 2, height, 24);
      geometry.scale(1, 1, depth / Math.max(width, 0.001));
      return geometry;
    }
    case 'plane': return new PlaneGeometry(width, depth);
    case 'torus': {
      const geometry = new TorusGeometry(width / 2, height / 2, 12, 32);
      geometry.scale(1, 1, depth / Math.max(width, 0.001));
      return geometry;
    }
    case 'custom': {
      const geometry = new BufferGeometry();
      if (!object.geometry?.positions.length) throw new Error(`El objeto "${object.name}" no contiene geometría válida.`);
      geometry.setAttribute('position', new Float32BufferAttribute(object.geometry.positions, 3));
      if (object.geometry.normals) geometry.setAttribute('normal', new Float32BufferAttribute(object.geometry.normals, 3));
      if (object.geometry.indices) geometry.setIndex(object.geometry.indices);
      if (!object.geometry.normals) geometry.computeVertexNormals();
      return geometry;
    }
  }
}
