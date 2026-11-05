export type BridgeType =
  | 'beam'
  | 'slab'
  | 'box-girder'
  | 'cable-stayed'
  | 'suspension'
  | 'arch'
  | 'truss'
  | 'viaduct'
  | 'pedestrian'
  | 'highway';

export type PrimitiveType = 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane' | 'torus';
export type BridgeObjectKind = PrimitiveType | 'custom';
export type BridgeTool = 'select' | 'translate' | 'rotate' | 'scale';
export type BridgeUnit = 'm' | 'cm' | 'mm';

export interface BridgeGeometryData {
  positions: number[];
  indices?: number[];
  normals?: number[];
}

export interface BridgeObject {
  id: string;
  name: string;
  kind: BridgeObjectKind;
  role: 'structure' | 'iot' | 'primitive' | 'imported';
  dimensions: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
  roughness: number;
  metalness: number;
  opacity?: number;
  visible: boolean;
  locked: boolean;
  collection: string;
  groupId?: string;
  geometry?: BridgeGeometryData;
  association?: {
    bridgeComponentId: string;
    deviceId: string;
    sensorId?: string;
    sensorType?: string;
    status: 'unconnected' | 'connected';
    lastUpdated?: string;
  };
}

export interface BridgeSceneGroup {
  id: string;
  name: string;
}

export interface BridgeSceneDocument {
  schemaVersion: 1;
  id: string;
  projectId: string;
  name: string;
  bridgeType: BridgeType | null;
  bridgeParameters?: BridgeParameters;
  unit: BridgeUnit;
  gridSize: number;
  groups: BridgeSceneGroup[];
  objects: BridgeObject[];
  updatedAt: string;
}

export interface BridgeParameters {
  name: string;
  type: BridgeType;
  length: number;
  width: number;
  deckHeight: number;
  pierHeight: number;
  spans: number;
  lanes: number;
  unit: BridgeUnit;
}
