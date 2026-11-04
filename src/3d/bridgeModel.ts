import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';

function addBox(parent: Group, material: MeshStandardMaterial, size: [number, number, number], position: [number, number, number]) {
  const mesh = new Mesh(new BoxGeometry(...size), material);
  mesh.position.set(...position);
  parent.add(mesh);
}

export function makeIllustrativeBridge(): Group {
  const bridge = new Group();
  const deckMaterial = new MeshStandardMaterial({ color: '#75879a', roughness: 0.72, metalness: 0.28 });
  const concreteMaterial = new MeshStandardMaterial({ color: '#8b99a7', roughness: 0.86 });
  const cableMaterial = new MeshStandardMaterial({ color: '#4d79a5', roughness: 0.44, metalness: 0.48 });
  const deckEdgeMaterial = new MeshStandardMaterial({ color: '#55708a', roughness: 0.63 });

  addBox(bridge, deckMaterial, [28, 0.55, 5.4], [0, 0, 0]);
  addBox(bridge, deckEdgeMaterial, [28, 0.18, 0.15], [0, 0.36, -2.63]);
  addBox(bridge, deckEdgeMaterial, [28, 0.18, 0.15], [0, 0.36, 2.63]);

  for (const x of [-9, 9]) {
    addBox(bridge, concreteMaterial, [0.85, 10, 0.9], [x, 5.05, -2.05]);
    addBox(bridge, concreteMaterial, [0.85, 10, 0.9], [x, 5.05, 2.05]);
    addBox(bridge, concreteMaterial, [1.1, 0.7, 5.5], [x, 10.1, 0]);
    addBox(bridge, concreteMaterial, [2.4, 0.85, 2.4], [x, -0.75, 0]);
    addBox(bridge, concreteMaterial, [1.35, 7.5, 1.4], [x, -4.85, 0]);
  }

  for (const z of [-2.05, 2.05]) {
    const cable = new CatmullRomCurve3([
      new Vector3(-9, 10.15, z),
      new Vector3(-5, 7.8, z),
      new Vector3(0, 6.7, z),
      new Vector3(5, 7.8, z),
      new Vector3(9, 10.15, z),
    ]);
    bridge.add(new Line(
      new BufferGeometry().setFromPoints(cable.getPoints(48)),
      new LineBasicMaterial({ color: '#78a8d7' }),
    ));
    for (let x = -7; x <= 7; x += 2) {
      const cableY = cable.getPoint((x + 9) / 18).y;
      const hanger = new Mesh(
        new BoxGeometry(0.055, Math.max(0.15, cableY - 0.4), 0.055),
        cableMaterial,
      );
      hanger.position.set(x, (cableY + 0.4) / 2, z);
      bridge.add(hanger);
    }
  }

  return bridge;
}
