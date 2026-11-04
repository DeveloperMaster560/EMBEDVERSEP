import type { BridgeObject, BridgeParameters, BridgeSceneDocument } from './types';

const objectKinds = new Set(['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus', 'custom']);
const objectRoles = new Set(['structure', 'iot', 'primitive', 'imported']);
const bridgeTypes = new Set(['beam', 'slab', 'box-girder', 'cable-stayed', 'suspension', 'arch', 'truss', 'viaduct', 'pedestrian', 'highway']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteTriple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === 'number' && Number.isFinite(part));
}

function isBridgeObject(value: unknown): value is BridgeObject {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || !objectKinds.has(String(value.kind))
    || !objectRoles.has(String(value.role))
    || !isFiniteTriple(value.dimensions)
    || !isFiniteTriple(value.position)
    || !isFiniteTriple(value.rotation)
    || !isFiniteTriple(value.scale)
    || typeof value.color !== 'string'
    || !/^#[\da-f]{6}$/i.test(value.color)
    || typeof value.roughness !== 'number'
    || value.roughness < 0 || value.roughness > 1
    || typeof value.metalness !== 'number'
    || value.metalness < 0 || value.metalness > 1
    || typeof value.visible !== 'boolean'
    || typeof value.locked !== 'boolean'
    || typeof value.collection !== 'string') return false;

  if (value.kind === 'custom') {
    const geometry = value.geometry;
    if (!isRecord(geometry) || !Array.isArray(geometry.positions)) return false;
    const positions = geometry.positions;
    if (positions.length === 0 || positions.length % 3 !== 0
      || positions.length > 3_000_000
      || !positions.every((part) => typeof part === 'number' && Number.isFinite(part))) return false;
    const vertexCount = positions.length / 3;
    if (geometry.indices !== undefined) {
      if (!Array.isArray(geometry.indices)
        || geometry.indices.length > 3_000_000
        || !geometry.indices.every((part) => Number.isInteger(part) && part >= 0 && part < vertexCount)) return false;
    }
    if (geometry.normals !== undefined) {
      if (!Array.isArray(geometry.normals)
        || geometry.normals.length !== positions.length
        || !geometry.normals.every((part) => typeof part === 'number' && Number.isFinite(part))) return false;
    }
  }
  if (value.association !== undefined) {
    if (!isRecord(value.association)
      || typeof value.association.bridgeComponentId !== 'string'
      || typeof value.association.deviceId !== 'string'
      || (value.association.sensorId !== undefined && typeof value.association.sensorId !== 'string')
      || (value.association.sensorType !== undefined && typeof value.association.sensorType !== 'string')
      || !['unconnected', 'connected'].includes(String(value.association.status))) return false;
  }
  return true;
}

function isBridgeParameters(value: unknown): value is BridgeParameters {
  return isRecord(value)
    && typeof value.name === 'string'
    && bridgeTypes.has(String(value.type))
    && typeof value.length === 'number' && Number.isFinite(value.length) && value.length > 0
    && typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0
    && typeof value.deckHeight === 'number' && Number.isFinite(value.deckHeight) && value.deckHeight >= 0
    && typeof value.pierHeight === 'number' && Number.isFinite(value.pierHeight) && value.pierHeight > 0
    && typeof value.spans === 'number' && Number.isInteger(value.spans) && value.spans >= 1 && value.spans <= 20
    && typeof value.lanes === 'number' && Number.isInteger(value.lanes) && value.lanes >= 1 && value.lanes <= 12
    && ['m', 'cm', 'mm'].includes(String(value.unit));
}

export function parseBridgeScene(serialized: string, projectId: string): BridgeSceneDocument {
  if (serialized.length > 50 * 1024 * 1024) throw new Error('El archivo .evbridge supera el límite de 50 MiB.');
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('El archivo no contiene JSON válido.');
  }
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || value.name.length > 500
    || !Array.isArray(value.objects)
    || value.objects.length > 100_000
    || !value.objects.every(isBridgeObject)
    || !['m', 'cm', 'mm'].includes(String(value.unit))
    || typeof value.gridSize !== 'number'
    || !Number.isFinite(value.gridSize)
    || value.gridSize <= 0
    || (value.bridgeParameters !== undefined && !isBridgeParameters(value.bridgeParameters))
    || (value.bridgeType !== null && !bridgeTypes.has(String(value.bridgeType)))) {
    throw new Error('El archivo no contiene un proyecto .evbridge válido o compatible.');
  }
  const objectIds = new Set((value.objects as BridgeObject[]).map((object) => object.id));
  if (objectIds.size !== (value.objects as BridgeObject[]).length) {
    throw new Error('El proyecto contiene identificadores de objeto duplicados.');
  }
  if ((value.objects as BridgeObject[]).some((object) =>
    object.association?.bridgeComponentId
    && !objectIds.has(object.association.bridgeComponentId))) {
    throw new Error('El proyecto contiene una asociación a un objeto inexistente.');
  }
  return {
    ...value,
    projectId,
    unit: value.unit as BridgeSceneDocument['unit'],
    bridgeType: value.bridgeType as BridgeSceneDocument['bridgeType'],
    objects: value.objects as BridgeObject[],
  } as BridgeSceneDocument;
}
