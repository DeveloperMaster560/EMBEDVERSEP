/**
 * Puente entre el modelo generado y el editor 3D (`src/bridge-designer`).
 *
 * El Studio genera geometría correcta pero no editable: es un visor. El editor
 * sabe seleccionar, transformar, duplicar, agrupar, deshacer, añadir piezas
 * nuevas, importar, exportar y guardar, pero no sabe generar. Esta pieza lleva
 * lo generado al editor conservando su identidad: cada componente llega con su
 * `component_id` en el nombre, su disciplina como colección y su zona como
 * grupo, así que se puede mover un vano entero o apagar una disciplina.
 *
 * Reenviar el modelo **reemplaza** los componentes enviados antes y **conserva**
 * todo lo que el usuario haya añadido por su cuenta. El identificador de cada
 * objeto se deriva del `component_id`, de modo que la correspondencia es exacta
 * y no se acumulan duplicados.
 */

import type { BridgeObject, BridgeSceneDocument, BridgeSceneGroup } from '../bridge-designer/types';
import { loadBridgeScene, saveBridgeScene } from '../bridge-designer/persistence';
import { createScene } from '../bridge-designer/scene';
import { presetFor } from './materials';
import { zoneOrder, type ModelDomain } from './scene-graph';
import type { ExtractedComponent } from './ModelViewport';
import type { GeneratedComponentSummary, GeneratedZone } from './contracts';

/** Marca de los objetos que vienen del generador, no de la mano del usuario. */
export const GENERATED_PREFIX = 'gen:';

export interface EditorHandoff {
  objects: BridgeObject[];
  groups: BridgeSceneGroup[];
  triangles: number;
}

function generatedId(componentId: string): string {
  return `${GENERATED_PREFIX}${componentId}`;
}

export function isGeneratedObject(object: BridgeObject): boolean {
  return object.id.startsWith(GENERATED_PREFIX);
}

/** Convierte la geometría extraída en objetos editables del editor 3D. */
export function buildEditorHandoff(
  extracted: ExtractedComponent[],
  components: GeneratedComponentSummary[],
  zones: GeneratedZone[],
  domain: ModelDomain,
  disciplineLabel: Record<string, string>,
): EditorHandoff {
  const catalogue = new Map(components.map((c) => [c.component_id, c]));
  const zoneName = new Map(zones.map((z) => [z.level_id, z.name]));

  const usedZones = new Set<string>();
  extracted.forEach((item) => {
    if (item.level) usedZones.add(item.level);
  });
  const groups: BridgeSceneGroup[] = [...usedZones]
    .sort((a, b) => zoneOrder(domain, a) - zoneOrder(domain, b))
    .map((zone) => ({
      id: `${GENERATED_PREFIX}zona:${zone}`,
      name: `${zone} · ${zoneName.get(zone) ?? 'Zona'}`,
    }));

  let triangles = 0;
  const objects: BridgeObject[] = extracted.map((item) => {
    const summary = catalogue.get(item.componentId);
    const preset = presetFor(summary?.material ?? null);
    triangles += item.triangles;
    return {
      id: generatedId(item.componentId),
      name: summary ? `${item.componentId} · ${summary.name}` : item.componentId,
      kind: 'custom',
      role: 'structure',
      // En una malla propia el editor ignora `dimensions`; se deja en 1 para
      // que el panel numérico muestre un valor honesto y no un cero engañoso.
      dimensions: [1, 1, 1],
      position: item.center,
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: preset.color,
      roughness: preset.roughness,
      metalness: preset.metalness,
      opacity: preset.opacity ?? 1,
      visible: true,
      locked: false,
      collection: disciplineLabel[item.discipline] ?? item.discipline,
      ...(item.level ? { groupId: `${GENERATED_PREFIX}zona:${item.level}` } : {}),
      geometry: { positions: item.positions, ...(item.indices ? { indices: item.indices } : {}) },
    };
  });

  return { objects, groups, triangles };
}

export interface HandoffResult {
  added: number;
  replaced: number;
  kept: number;
  triangles: number;
}

export interface MergeOutcome {
  scene: BridgeSceneDocument;
  result: HandoffResult;
}

/**
 * Funde el modelo en una escena existente.
 *
 * No destruye nada del usuario: solo sustituye los objetos que ya venían del
 * generador. Es pura a propósito, para poder comprobar esa promesa sin montar
 * un navegador ni una base de datos.
 */
export function mergeIntoScene(
  base: BridgeSceneDocument,
  handoff: EditorHandoff,
  timestamp: string,
): MergeOutcome {
  const previous = base.objects.filter(isGeneratedObject);
  const userObjects = base.objects.filter((object) => !isGeneratedObject(object));
  const userGroups = (base.groups ?? []).filter((group) => !group.id.startsWith(GENERATED_PREFIX));

  return {
    scene: {
      ...base,
      objects: [...userObjects, ...handoff.objects],
      groups: [...userGroups, ...handoff.groups],
      updatedAt: timestamp,
    },
    result: {
      added: handoff.objects.length,
      replaced: previous.length,
      kept: userObjects.length,
      triangles: handoff.triangles,
    },
  };
}

/** Deja el modelo en la escena del editor para ese proyecto. */
export async function sendToEditor(
  projectId: string,
  projectName: string,
  handoff: EditorHandoff,
): Promise<HandoffResult> {
  const existing = await loadBridgeScene(projectId);
  const base: BridgeSceneDocument = existing
    ? { ...existing, groups: existing.groups ?? [] }
    : createScene(projectId, projectName);

  const { scene, result } = mergeIntoScene(base, handoff, new Date().toISOString());
  await saveBridgeScene(scene);
  return result;
}
