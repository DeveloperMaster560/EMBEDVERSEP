import { describe, expect, it } from 'vitest';

import {
  buildEditorHandoff,
  isGeneratedObject,
  mergeIntoScene,
  GENERATED_PREFIX,
} from './to-editor';
import type { ExtractedComponent } from './ModelViewport';
import type { GeneratedComponentSummary, GeneratedZone } from './contracts';
import type { BridgeObject, BridgeSceneDocument } from '../bridge-designer/types';

const extracted: ExtractedComponent[] = [
  {
    componentId: 'EST-VIG-001',
    discipline: 'structure',
    level: 'V1',
    positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
    indices: [0, 1, 2],
    center: [15, 6, 0],
    triangles: 1,
  },
  {
    componentId: 'TAB-LOSA-001',
    discipline: 'deck',
    level: 'TAB',
    positions: [0, 0, 0, 2, 0, 0, 2, 2, 0],
    indices: undefined,
    center: [45, 7, 0],
    triangles: 1,
  },
];

const components: GeneratedComponentSummary[] = [
  {
    component_id: 'EST-VIG-001',
    discipline: 'structure',
    type: 'main_girder',
    name: 'Viga principal 1',
    level_id: 'V1',
    space_id: null,
    material: 'concreto_pretensado',
    pending_count: 4,
  },
  {
    component_id: 'TAB-LOSA-001',
    discipline: 'deck',
    type: 'deck_slab',
    name: 'Losa de tablero',
    level_id: 'TAB',
    space_id: null,
    material: null,
    pending_count: 2,
  },
];

const zones: GeneratedZone[] = [
  { level_id: 'TAB', name: 'Tablero', elevation: 7 },
  { level_id: 'V1', name: 'Vano 1', elevation: 0 },
];

const LABELS = { structure: 'Estructura', deck: 'Tablero y calzada' };

function userObject(id: string): BridgeObject {
  return {
    id,
    name: `Pieza del usuario ${id}`,
    kind: 'box',
    role: 'primitive',
    dimensions: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: '#548dcc',
    roughness: 0.5,
    metalness: 0.1,
    visible: true,
    locked: false,
    collection: 'Objetos',
  };
}

function sceneWith(objects: BridgeObject[]): BridgeSceneDocument {
  return {
    schemaVersion: 1,
    id: 'escena',
    projectId: 'proyecto',
    name: 'Escena',
    bridgeType: null,
    unit: 'm',
    gridSize: 1,
    groups: [{ id: 'grupo-usuario', name: 'Mi grupo' }],
    objects,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('buildEditorHandoff', () => {
  const handoff = buildEditorHandoff(extracted, components, zones, 'bridge', LABELS);

  it('convierte cada componente en un objeto editable con geometría propia', () => {
    expect(handoff.objects).toHaveLength(2);
    const viga = handoff.objects[0];
    expect(viga.kind).toBe('custom');
    expect(viga.geometry?.positions).toEqual(extracted[0].positions);
    expect(viga.geometry?.indices).toEqual([0, 1, 2]);
    expect(viga.visible).toBe(true);
    expect(viga.locked).toBe(false);
  });

  it('coloca cada pieza en su centro, para que gire sobre sí misma', () => {
    expect(handoff.objects[0].position).toEqual([15, 6, 0]);
    expect(handoff.objects[1].position).toEqual([45, 7, 0]);
  });

  it('conserva el identificador del componente en el nombre y en el id', () => {
    expect(handoff.objects[0].id).toBe(`${GENERATED_PREFIX}EST-VIG-001`);
    expect(handoff.objects[0].name).toContain('EST-VIG-001');
    expect(handoff.objects[0].name).toContain('Viga principal 1');
  });

  it('usa la disciplina como colección y la zona como grupo', () => {
    expect(handoff.objects[0].collection).toBe('Estructura');
    expect(handoff.objects[1].collection).toBe('Tablero y calzada');
    expect(handoff.objects[0].groupId).toBe(`${GENERATED_PREFIX}zona:V1`);
    expect(handoff.groups.map((g) => g.id)).toEqual([
      `${GENERATED_PREFIX}zona:V1`,
      `${GENERATED_PREFIX}zona:TAB`,
    ]);
    expect(handoff.groups[0].name).toContain('Vano 1');
  });

  it('toma el aspecto del material declarado y no inventa uno para los que no lo tienen', () => {
    expect(handoff.objects[0].color).toBe('#c3c0b7'); // concreto pretensado
    expect(handoff.objects[1].color).toBe('#9aa0a6'); // sin material declarado
  });

  it('omite la clave de índices cuando la malla no los trae', () => {
    expect(handoff.objects[1].geometry).not.toHaveProperty('indices');
  });

  it('suma los triángulos enviados', () => {
    expect(handoff.triangles).toBe(2);
  });

  it('no se rompe si un componente extraído no está en el catálogo', () => {
    const huerfano = buildEditorHandoff(extracted, [], zones, 'bridge', LABELS);
    expect(huerfano.objects[0].name).toBe('EST-VIG-001');
    expect(huerfano.objects[0].color).toBe('#9aa0a6');
  });
});

describe('mergeIntoScene', () => {
  const handoff = buildEditorHandoff(extracted, components, zones, 'bridge', LABELS);

  it('conserva intacto lo que añadió el usuario', () => {
    const base = sceneWith([userObject('mio-1'), userObject('mio-2')]);
    const { scene, result } = mergeIntoScene(base, handoff, '2026-11-06T00:00:00.000Z');
    expect(result.kept).toBe(2);
    expect(result.added).toBe(2);
    expect(result.replaced).toBe(0);
    expect(scene.objects.filter((o) => !isGeneratedObject(o))).toHaveLength(2);
    expect(scene.groups.some((g) => g.id === 'grupo-usuario')).toBe(true);
  });

  it('reemplaza el envío anterior en vez de duplicarlo', () => {
    const base = sceneWith([userObject('mio-1')]);
    const primero = mergeIntoScene(base, handoff, '2026-11-06T00:00:00.000Z');
    const segundo = mergeIntoScene(primero.scene, handoff, '2026-11-06T00:01:00.000Z');
    expect(segundo.result.replaced).toBe(2);
    expect(segundo.result.kept).toBe(1);
    expect(segundo.scene.objects).toHaveLength(3);
    const ids = segundo.scene.objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no acumula grupos del generador al reenviar', () => {
    const base = sceneWith([]);
    const primero = mergeIntoScene(base, handoff, '2026-11-06T00:00:00.000Z');
    const segundo = mergeIntoScene(primero.scene, handoff, '2026-11-06T00:01:00.000Z');
    expect(segundo.scene.groups).toHaveLength(primero.scene.groups.length);
  });

  it('sella la fecha que se le pasa, sin leer el reloj', () => {
    const { scene } = mergeIntoScene(sceneWith([]), handoff, '2026-11-06T12:00:00.000Z');
    expect(scene.updatedAt).toBe('2026-11-06T12:00:00.000Z');
  });

  it('tolera una escena antigua sin grupos', () => {
    const base = { ...sceneWith([]), groups: undefined as unknown as BridgeSceneDocument['groups'] };
    expect(() => mergeIntoScene(base, handoff, '2026-11-06T00:00:00.000Z')).not.toThrow();
  });
});
