export type BoardId = 'arduino-uno' | 'esp32-devkit';

export interface ProjectFile {
  id: string;
  path: string;
  content: string;
}

export interface CircuitComponent {
  id: string;
  kind: 'board' | 'power' | 'ground' | 'led' | 'resistor' | 'button' | 'capacitor' | 'esp32' | 'mpu6050' | 'custom';
  label: string;
  description: string;
  x?: number;
  y?: number;
  rotation?: number;
  value?: string;
  libraryComponentId?: string;
}

export type CircuitPinType = 'power' | 'ground' | 'signal' | 'passive';

export interface CircuitLibraryPin {
  id: string;
  label: string;
  type: CircuitPinType;
  x: number;
  y: number;
  required?: boolean;
}

export interface CircuitLibraryComponent {
  id: string;
  name: string;
  manufacturer: string;
  reference: string;
  category: string;
  description: string;
  compatibleBoards: BoardId[];
  operatingVoltage: { min: number; max: number } | null;
  interfaces: string[];
  pins: CircuitLibraryPin[];
  datasheetUrl?: string;
  arduinoLibrary?: {
    name: string;
    version?: string;
    url: string;
    header?: string;
  };
}

export interface CircuitLibraryPackage {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  license: string;
  sourceUrl?: string;
  components: CircuitLibraryComponent[];
}

export interface CircuitConnection {
  from: string;
  to: string;
  fromPin?: string;
  toPin?: string;
  color?: string;
}

export interface ElectronicCircuit {
  name: string;
  boardId: BoardId;
  components: CircuitComponent[];
  connections: CircuitConnection[];
  componentLibraries?: CircuitLibraryPackage[];
}

export interface EmbeddedProject {
  id: string;
  name: string;
  boardId: BoardId;
  description: string;
  files: ProjectFile[];
  activeFileId: string;
  digitalTwin?: DigitalTwinScene;
  electronicLab?: ElectronicCircuit;
  createdAt: string;
  updatedAt: string;
}

export interface DigitalTwinAsset {
  name: string;
  type: string;
  data: ArrayBuffer;
}

export interface DigitalTwinScene {
  kind: 'generated' | 'imported';
  name: string;
  assets?: DigitalTwinAsset[];
}

export type ComponentCategory =
  | 'microcontrollers'
  | 'inertial'
  | 'environmental'
  | 'distance'
  | 'actuators'
  | 'displays';

export interface ComponentDefinition {
  id: string;
  name: string;
  manufacturer: string;
  reference: string;
  category: ComponentCategory;
  description: string;
  operatingVoltage: { min: number; max: number } | null;
  interfaces: string[];
  pins: { name: string; type: string }[];
  compatibleBoards: BoardId[];
  implementation: 'visual' | 'configurable' | 'functional' | 'firmware' | 'physics';
}
