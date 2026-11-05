import type {
  BoardId,
  CircuitLibraryComponent,
  CircuitLibraryPackage,
  CircuitPinType,
} from './types';

const pinTypes = new Set<CircuitPinType>(['power', 'ground', 'signal', 'passive']);
const boardIds = new Set<BoardId>(['arduino-uno', 'esp32-devkit']);
const maxPackageBytes = 1024 * 1024;
const maxComponents = 500;
const maxPinsPerComponent = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isSafeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isComponent(value: unknown): value is CircuitLibraryComponent {
  if (!isRecord(value)
    || !isText(value.id, 100)
    || !/^[a-z0-9][a-z0-9._-]*$/i.test(value.id)
    || !isText(value.name, 200)
    || !isText(value.manufacturer, 200)
    || !isText(value.reference, 200)
    || !isText(value.category, 100)
    || !isText(value.description, 2000)
    || !Array.isArray(value.compatibleBoards)
    || !value.compatibleBoards.length
    || !value.compatibleBoards.every((board) => boardIds.has(board as BoardId))
    || !Array.isArray(value.interfaces)
    || value.interfaces.length > 30
    || !value.interfaces.every((item) => isText(item, 100))
    || !Array.isArray(value.pins)
    || value.pins.length === 0
    || value.pins.length > maxPinsPerComponent) return false;

  if (value.operatingVoltage !== null && (!isRecord(value.operatingVoltage)
    || typeof value.operatingVoltage.min !== 'number'
    || !Number.isFinite(value.operatingVoltage.min)
    || typeof value.operatingVoltage.max !== 'number'
    || !Number.isFinite(value.operatingVoltage.max)
    || value.operatingVoltage.min < 0
    || value.operatingVoltage.max < value.operatingVoltage.min
    || value.operatingVoltage.max > 1000)) return false;

  const pinIds = new Set<string>();
  for (const pin of value.pins) {
    if (!isRecord(pin)
      || !isText(pin.id, 100)
      || !/^[a-z0-9][a-z0-9._-]*$/i.test(pin.id)
      || !isText(pin.label, 100)
      || !pinTypes.has(pin.type as CircuitPinType)
      || typeof pin.x !== 'number' || !Number.isFinite(pin.x) || Math.abs(pin.x) > 500
      || typeof pin.y !== 'number' || !Number.isFinite(pin.y) || Math.abs(pin.y) > 500
      || (pin.required !== undefined && typeof pin.required !== 'boolean')
      || pinIds.has(pin.id)) return false;
    pinIds.add(pin.id);
  }

  if (value.datasheetUrl !== undefined && !isSafeUrl(value.datasheetUrl)) return false;
  if (value.arduinoLibrary !== undefined && (!isRecord(value.arduinoLibrary)
    || !isText(value.arduinoLibrary.name, 200)
    || !isSafeUrl(value.arduinoLibrary.url)
    || (value.arduinoLibrary.version !== undefined && !isText(value.arduinoLibrary.version, 100))
    || (value.arduinoLibrary.header !== undefined
      && (typeof value.arduinoLibrary.header !== 'string'
        || value.arduinoLibrary.header.length > 200
        || !/^[\w.-]+\.h$/i.test(value.arduinoLibrary.header))))) return false;
  return true;
}

function isCircuitLibraryPackage(value: unknown): value is CircuitLibraryPackage {
  return isRecord(value)
    && value.schemaVersion === 1
    && isText(value.id, 100)
    && /^[a-z0-9][a-z0-9._-]*$/i.test(value.id)
    && isText(value.name, 200)
    && isText(value.version, 100)
    && isText(value.license, 100)
    && (value.sourceUrl === undefined || isSafeUrl(value.sourceUrl))
    && Array.isArray(value.components)
    && value.components.length > 0
    && value.components.length <= maxComponents
    && value.components.every(isComponent);
}

export function parseComponentLibrary(serialized: string): CircuitLibraryPackage {
  if (new TextEncoder().encode(serialized).byteLength > maxPackageBytes) {
    throw new Error('La biblioteca supera el límite de 1 MiB.');
  }

  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('El archivo de biblioteca no contiene JSON válido.');
  }

  if (!isCircuitLibraryPackage(value)) {
    throw new Error('La biblioteca no cumple el formato EMBEDVERSE Component Library v1.');
  }

  const componentIds = value.components.map((component) => component.id);
  if (new Set(componentIds).size !== componentIds.length) {
    throw new Error('La biblioteca contiene identificadores de componente duplicados.');
  }

  return value;
}

export function findLibraryComponent(
  libraries: CircuitLibraryPackage[] | undefined,
  componentId: string | undefined,
): CircuitLibraryComponent | undefined {
  if (!componentId) return undefined;
  return libraries?.flatMap((library) => library.components).find((component) => component.id === componentId);
}

export function createLibraryCircuitComponent(definition: CircuitLibraryComponent, index: number) {
  return {
    id: crypto.randomUUID(),
    kind: 'custom' as const,
    libraryComponentId: definition.id,
    label: `${definition.reference || definition.name} · ${index}`,
    description: definition.description,
    value: undefined,
    x: 270 + ((index * 73) % 600),
    y: 130 + ((index * 61) % 340),
    rotation: 0,
  };
}
