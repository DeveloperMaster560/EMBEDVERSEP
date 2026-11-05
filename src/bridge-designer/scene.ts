import type { BridgeObject, BridgeParameters, BridgeSceneDocument, BridgeUnit, PrimitiveType } from './types';
import { canGenerateBridge, type BridgeSpecification } from './ai-contracts';

const materialColors = {
  concrete: '#9aa5ae',
  asphalt: '#343b43',
  steel: '#54718b',
  cable: '#9fb6cc',
  sidewalk: '#c4cbd0',
  sensor: '#e6a84b',
};

function object(
  name: string,
  kind: BridgeObject['kind'],
  dimensions: [number, number, number],
  position: [number, number, number],
  color: string,
  collection = 'Estructura',
  role: BridgeObject['role'] = 'structure',
  opacity = 1,
): BridgeObject {
  return {
    id: crypto.randomUUID(),
    name,
    kind,
    role,
    dimensions,
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color,
    roughness: color === materialColors.steel ? 0.38 : 0.82,
    metalness: color === materialColors.steel ? 0.55 : 0.08,
    opacity,
    visible: true,
    locked: false,
    collection,
  };
}

export function createPrimitive(kind: PrimitiveType, name?: string): BridgeObject {
  const defaults: Record<PrimitiveType, [number, number, number]> = {
    box: [2, 1, 2],
    sphere: [1, 1, 1],
    cylinder: [1, 2, 1],
    cone: [1, 2, 1],
    plane: [5, 0.05, 5],
    torus: [3, 0.5, 3],
  };
  const objectName = name ?? `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  const primitive = object(objectName, kind, defaults[kind], [0, defaults[kind][1] / 2, 0], '#548dcc', 'Objetos', 'primitive');
  if (kind === 'plane') primitive.rotation = [-Math.PI / 2, 0, 0];
  return primitive;
}

export function createSensorObject(kind: 'esp32' | 'mpu6050'): BridgeObject {
  const isBoard = kind === 'esp32';
  const sensor = object(
    isBoard ? 'ESP32 · sin conexión' : 'MPU6050 · sin conexión',
    'box',
    isBoard ? [0.55, 0.08, 0.28] : [0.22, 0.035, 0.18],
    [0, 1, 0],
    materialColors.sensor,
    'Sensores IoT',
    'iot',
  );
  sensor.association = {
    bridgeComponentId: '',
    deviceId: '',
    status: 'unconnected',
    sensorType: isBoard ? 'microcontroller' : 'inertial',
  };
  return sensor;
}

export function createBridgeObjects(parameters: BridgeParameters): BridgeObject[] {
  const {
    type,
    length,
    width,
    deckHeight,
    pierHeight,
    spans,
    lanes,
  } = parameters;
  if (![length, width, deckHeight, pierHeight, spans, lanes].every(Number.isFinite)
    || length <= 0 || width <= 0 || deckHeight < 0 || pierHeight <= 0
    || !Number.isInteger(spans) || spans < 1 || spans > 20
    || !Number.isInteger(lanes) || lanes < 1 || lanes > 12) {
    throw new Error('Dimensiones inválidas. Usa longitudes positivas y entre 1 y 20 vanos.');
  }

  const objects: BridgeObject[] = [];
  const deckThickness = Math.max(width * 0.08, 0.35);
  const deckY = deckHeight;
  const spanLength = length / spans;

  objects.push(object('Tablero estructural', 'box', [length, deckThickness, width], [0, deckY, 0], materialColors.concrete));
  objects.push(object('Calzada', 'box', [length, 0.06, width * 0.68], [0, deckY + deckThickness / 2 + 0.03, 0], materialColors.asphalt, 'Acabados'));
  for (let lane = 1; lane < lanes; lane += 1) {
    const z = -width * 0.34 + (width * 0.68 * lane) / lanes;
    objects.push(object(`Demarcación de carril ${lane}`, 'box', [length, 0.018, 0.035], [0, deckY + deckThickness / 2 + 0.071, z], '#e8e4d7', 'Acabados'));
  }
  objects.push(object('Acera norte', 'box', [length, 0.12, width * 0.14], [0, deckY + deckThickness / 2 + 0.1, -width * 0.43], materialColors.sidewalk, 'Acabados'));
  objects.push(object('Acera sur', 'box', [length, 0.12, width * 0.14], [0, deckY + deckThickness / 2 + 0.1, width * 0.43], materialColors.sidewalk, 'Acabados'));

  for (const z of [-width * 0.48, width * 0.48]) {
    objects.push(object(`Baranda ${z < 0 ? 'norte' : 'sur'}`, 'box', [length, 0.12, 0.12], [0, deckY + 0.78, z], materialColors.steel, 'Acabados'));
    for (let x = -length / 2 + 1; x <= length / 2; x += Math.max(2, length / 24)) {
      objects.push(object(`Poste de baranda ${Math.round(x + length / 2)}`, 'box', [0.1, 0.8, 0.1], [x, deckY + 0.4, z], materialColors.steel, 'Acabados'));
    }
  }

  const pierIndexes = Array.from({ length: Math.max(0, spans - 1) }, (_, index) => index + 1);
  for (const x of [-length / 2 + 0.5, length / 2 - 0.5]) {
    objects.push(object('Estribo', 'box', [1, Math.max(pierHeight * 0.4, 1), width], [x, deckY - Math.max(pierHeight * 0.4, 1) / 2, 0], materialColors.concrete, 'Estribos'));
  }
  for (const index of pierIndexes) {
    const x = -length / 2 + spanLength * index;
    objects.push(object(`Pila ${String(index).padStart(2, '0')}`, 'box', [1.2, pierHeight, width * 0.44], [x, deckY - pierHeight / 2, 0], materialColors.concrete));
    objects.push(object(`Cimentación ${String(index).padStart(2, '0')}`, 'box', [3, 0.9, width * 0.7], [x, deckY - pierHeight - 0.45, 0], materialColors.concrete, 'Cimentaciones'));
    objects.push(object(`Apoyo ${String(index).padStart(2, '0')}`, 'box', [1.5, 0.25, width * 0.48], [x, deckY - 0.1, 0], materialColors.steel, 'Apoyos'));
  }

  if (type === 'cable-stayed' || type === 'suspension') {
    const towerHeight = Math.max(pierHeight, length / 7);
    const towerX = type === 'suspension' ? [-length * 0.22, length * 0.22] : [-spanLength / 2, spanLength / 2];
    towerX.forEach((x, index) => {
      objects.push(object(`Pilon ${index + 1}`, 'box', [0.7, towerHeight, 0.8], [x, deckY + towerHeight / 2, 0], materialColors.concrete));
      if (type === 'suspension') return;
      for (const side of [-1, 1]) {
        const cableCount = 5;
        for (let cable = 0; cable < cableCount; cable += 1) {
          const ratio = (cable + 1) / (cableCount + 1);
          const endX = x + side * spanLength * ratio;
          const startY = deckY + towerHeight * (0.25 + 0.7 * ratio);
          const dx = endX - x;
          const dy = deckY - startY;
          const cableLength = Math.hypot(dx, dy);
          const cableObject = object(
            `Tirante ${index + 1}-${cable + 1}`,
            'cylinder',
            [0.035, cableLength, 0.035],
            [(x + endX) / 2, (startY + deckY) / 2, side * width * 0.37],
            materialColors.cable,
            'Cables',
          );
          cableObject.rotation[2] = Math.atan2(dx, -dy);
          objects.push(cableObject);
        }
      }
    });
    if (type === 'suspension') {
      const towerXOffset = length * 0.22;
      for (const z of [-width * 0.37, width * 0.37]) {
        const segmentCount = 28;
        const cableY = (x: number) => deckY + towerHeight - towerHeight * 0.38 * (x / towerXOffset) ** 2;
        for (let index = 0; index < segmentCount; index += 1) {
          const x0 = -length / 2 + (length * index) / segmentCount;
          const x1 = -length / 2 + (length * (index + 1)) / segmentCount;
          const y0 = x0 >= -towerXOffset && x0 <= towerXOffset ? cableY(x0) : deckY + towerHeight * 0.62;
          const y1 = x1 >= -towerXOffset && x1 <= towerXOffset ? cableY(x1) : deckY + towerHeight * 0.62;
          const dx = x1 - x0;
          const dy = y1 - y0;
          const mainCable = object('Cable principal', 'cylinder', [0.11, Math.hypot(dx, dy), 0.11], [(x0 + x1) / 2, (y0 + y1) / 2, z], materialColors.cable, 'Cables');
          mainCable.rotation[2] = Math.atan2(dx, dy);
          objects.push(mainCable);
        }
        for (let index = 1; index < 12; index += 1) {
          const x = -towerXOffset + (2 * towerXOffset * index) / 12;
          const top = cableY(x);
          objects.push(object('Colgante vertical', 'cylinder', [0.045, Math.max(top - deckY, 0.1), 0.045], [x, (top + deckY) / 2, z], materialColors.cable, 'Cables'));
        }
      }
    }
  }

  if (type === 'arch') {
    const archRise = Math.max(length * 0.12, 3);
    const archCount = 21;
    for (const side of [-1, 1]) {
      for (let index = 0; index < archCount - 1; index += 1) {
        const t0 = index / (archCount - 1);
        const t1 = (index + 1) / (archCount - 1);
        const x0 = -length / 2 + length * t0;
        const x1 = -length / 2 + length * t1;
        const y0 = deckY + archRise * 4 * t0 * (1 - t0);
        const y1 = deckY + archRise * 4 * t1 * (1 - t1);
        const segment = object('Arco · segmento', 'cylinder', [0.25, Math.hypot(x1 - x0, y1 - y0), 0.25], [(x0 + x1) / 2, (y0 + y1) / 2, side * width * 0.35], materialColors.steel, 'Arcos');
        segment.rotation[2] = Math.atan2(x1 - x0, y1 - y0);
        objects.push(segment);
      }
    }
    for (let x = -length / 2 + spanLength / 8; x < length / 2; x += spanLength / 8) {
      objects.push(object('Montante de arco', 'cylinder', [0.08, archRise * 0.65, 0.08], [x, deckY + archRise * 0.3, 0], materialColors.steel, 'Arcos'));
    }
  }

  if (type === 'truss') {
    const panelCount = Math.max(spans * 5, 5);
    for (let index = 0; index <= panelCount; index += 1) {
      const x = -length / 2 + (length / panelCount) * index;
      objects.push(object('Montante de cercha', 'box', [0.18, 3, 0.18], [x, deckY + 1.65, -width * 0.4], materialColors.steel, 'Cercha'));
      objects.push(object('Montante de cercha', 'box', [0.18, 3, 0.18], [x, deckY + 1.65, width * 0.4], materialColors.steel, 'Cercha'));
      if (index < panelCount) {
        const nextX = x + length / panelCount;
        for (const z of [-width * 0.4, width * 0.4]) {
          const diagonal = object('Diagonal de cercha', 'box', [0.14, Math.hypot(length / panelCount, 3), 0.14], [(x + nextX) / 2, deckY + 1.5, z], materialColors.steel, 'Cercha');
          diagonal.rotation[2] = Math.atan2(length / panelCount, 3) * (index % 2 === 0 ? 1 : -1);
          objects.push(diagonal);
        }
      }
    }
  }

  if (type === 'box-girder') {
    for (const z of [-width * 0.28, width * 0.28]) {
      objects.push(object('Viga cajón', 'box', [length, deckThickness * 1.8, width * 0.22], [0, deckY - deckThickness, z], materialColors.steel, 'Vigas'));
    }
  } else if (type === 'beam' || type === 'highway' || type === 'viaduct' || type === 'pedestrian') {
    const girderCount = type === 'pedestrian' ? 2 : 4;
    for (let index = 0; index < girderCount; index += 1) {
      const z = -width * 0.36 + (width * 0.72 * index) / Math.max(girderCount - 1, 1);
      objects.push(object(`Viga longitudinal ${index + 1}`, 'box', [length, deckThickness * 1.25, 0.32], [0, deckY - deckThickness, z], materialColors.steel, 'Vigas'));
    }
  }

  for (let x = -length / 2 + 2; x < length / 2; x += Math.max(8, length / 8)) {
    objects.push(object('Luminaria', 'cylinder', [0.07, 3.2, 0.07], [x, deckY + 1.7, -width * 0.4], '#e7d99a', 'Iluminación'));
  }

  return objects;
}

export function createAiBridgeObjects(specification: BridgeSpecification, unit: BridgeUnit): BridgeObject[] {
  if (!canGenerateBridge(specification)) {
    throw new Error('Resuelve las preguntas de aclaración antes de generar la geometría.');
  }

  const { lengthM, widthM, heightM } = specification.overallDimensions;
  if (lengthM === null || widthM === null || heightM === null) {
    throw new Error('Faltan dimensiones necesarias para generar la geometría.');
  }
  const length = lengthM;
  const width = widthM;
  const deckElevation = heightM;
  const unitFactor: Record<BridgeUnit, number> = { m: 1, cm: 100, mm: 1000 };
  const scale = unitFactor[unit];
  const deckThickness = (specification.deck.thicknessM ?? Math.max(0.4, Math.min(1.2, length * 0.025))) * scale;
  const girderHeight = Math.max(0.5, Math.min(2, width * 0.09)) * scale;
  const girderWidth = Math.max(0.25, Math.min(0.6, width * 0.045)) * scale;
  const lengthInScene = length * scale;
  const widthInScene = width * scale;
  const deckTop = deckElevation * scale;
  const deckBottom = deckTop - deckThickness;
  const cableStayed = specification.cableStayed;
  const supportTop = deckBottom - (specification.structureType === 'beam' ? girderHeight : 0);
  if (supportTop <= 0) throw new Error('La altura del tablero debe superar el espesor conceptual de la estructura.');

  const enabled = new Set(specification.components.filter(({ included }) => included).map(({ type }) => type));
  const objects: BridgeObject[] = [];
  const add = (
    name: string,
    dimensions: [number, number, number],
    position: [number, number, number],
    color: string,
    collection = 'Puente asistido localmente',
    kind: BridgeObject['kind'] = 'box',
    rotation: [number, number, number] = [0, 0, 0],
    opacity = 1,
  ) => {
    const item = object(name, kind, dimensions, position, color, collection, 'structure', opacity);
    item.rotation = rotation;
    item.roughness = 0.3;
    item.metalness = 0.72;
    objects.push(item);
  };
  const addCable = (
    name: string,
    start: [number, number, number],
    end: [number, number, number],
    radius: number,
  ) => {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const dz = end[2] - start[2];
    const length = Math.hypot(dx, dy, dz);
    add(name, [radius * 2, length, radius * 2], [
      (start[0] + end[0]) / 2,
      (start[1] + end[1]) / 2,
      (start[2] + end[2]) / 2,
    ], '#74e8ff', 'Tirantes · acero conceptual', 'cylinder', [
      Math.asin(dz / length),
      0,
      Math.atan2(-dx, dy),
    ], 0.8);
  };

  add('Bridge_Deck', [lengthInScene, deckThickness, widthInScene], [0, deckTop - deckThickness / 2, 0], materialColors.concrete);

  if (specification.structureType === 'cable_stayed') {
    const towerHeight = (cableStayed?.towerHeightM ?? Math.max(length * 0.25, 30)) * scale;
    const towerDistance = (cableStayed?.towerSpacingM ?? length * 0.36) * scale;
    const towerStations = [-towerDistance / (2 * scale), towerDistance / (2 * scale)];
    const towerSectionDepth = (cableStayed?.towerSectionDepthM ?? Math.max(width * 0.035, 1.4)) * scale;
    const towerPortalHalfSpan = width * 0.32 * scale;
    const towerLegWidth = (cableStayed?.towerSectionWidthM ?? Math.max(width * 0.035, 1.4)) * scale;
    const girderCount = cableStayed?.mainGirderCount ?? Math.max(4, Math.floor(width / 4));
    const cableDiameter = (cableStayed?.stayCableDiameterM ?? Math.max(0.07, width * 0.004)) * scale;
    const crossBeamSpacing = (cableStayed?.crossBeamSpacingM ?? 12) * scale;
    const foundationLength = (cableStayed?.foundationLengthM ?? towerLegWidth * 2.8 / scale) * scale;
    const foundationWidth = (cableStayed?.foundationWidthM ?? towerSectionDepth * 2.8 / scale) * scale;
    const foundationDepth = (cableStayed?.foundationDepthM ?? Math.max(1.5, width * 0.05)) * scale;
    const girderSectionHeight = (cableStayed?.mainGirderHeightM ?? girderHeight / scale) * scale;
    const girderSectionWidth = (cableStayed?.mainGirderWidthM ?? girderWidth / scale) * scale;
    const crossBeamWidth = (cableStayed?.crossBeamWidthM ?? Math.max(0.5, width * 0.025)) * scale;
    const crossBeamHeight = (cableStayed?.crossBeamHeightM ?? girderHeight * 0.7 / scale) * scale;
    const railHeight = (cableStayed?.guardrailHeightM ?? 1.2) * scale;
    objects[0].color = '#739bad';
    objects[0].opacity = 0.58;
    if (enabled.has('main_girder')) {
      for (let index = 0; index < girderCount; index += 1) {
        const z = (-width * 0.2 + (width * 0.4 * index) / (girderCount - 1)) * scale;
        add(`Longitudinal_Girder_${String(index + 1).padStart(2, '0')}`,
          [lengthInScene, girderSectionHeight, girderSectionWidth],
          [0, deckBottom - girderHeight / 2, z],
          '#57aeca', 'Vigas principales', 'box', [0, 0, 0], 0.72);
      }
    }

    if (enabled.has('cross_beam')) {
      const beamCount = Math.max(1, Math.ceil(lengthInScene / crossBeamSpacing));
      for (let index = 0; index <= beamCount; index += 1) {
        const x = (-length / 2 + (length * index) / beamCount) * scale;
        add(`Cross_Beam_${String(index + 1).padStart(2, '0')}`,
          [crossBeamWidth, crossBeamHeight, widthInScene],
          [x, deckBottom - girderHeight * 0.25, 0],
          '#4c91ae', 'Vigas transversales', 'box', [0, 0, 0], 0.7);
      }
    }

    towerStations.forEach((station, towerIndex) => {
      const centerX = station * scale;
      const inward = towerIndex === 0 ? 1 : -1;
      const lean = inward * towerHeight * 0.025;
      const towerTotalHeight = deckTop + towerHeight - foundationDepth;
      for (const side of [-1, 1]) {
        const z = side * towerPortalHalfSpan;
        add(`Tower_${towerIndex + 1}_Leg_${side < 0 ? 'Left' : 'Right'}`,
          [towerLegWidth, towerTotalHeight, towerSectionDepth],
          [centerX + lean / 2, foundationDepth + towerTotalHeight / 2, z],
          '#55b9d6', 'Torres · pórticos', 'box', [0, 0, -inward * 0.025], 0.62);
        if (enabled.has('foundation')) {
          add(`Foundation_${towerIndex + 1}_${side < 0 ? 'Left' : 'Right'}`,
            [foundationLength, foundationDepth, foundationWidth],
            [centerX, foundationDepth / 2, z],
            '#8599a5', 'Cimentaciones conceptuales', 'box', [0, 0, 0], 0.72);
        }
        const bearingHeight = Math.max(0.35, width * 0.012) * scale;
        if (enabled.has('support')) {
          add(`Bearing_${towerIndex + 1}_${side < 0 ? 'Left' : 'Right'}`,
            [towerLegWidth * 1.6, bearingHeight, towerSectionDepth * 1.6],
            [centerX, deckBottom + bearingHeight / 2, z],
            '#8de8f7', 'Apoyos estructurales', 'box', [0, 0, 0], 0.78);
        }
      }
      add(`Tower_${towerIndex + 1}_Crosshead`,
        [towerLegWidth * 1.4, towerLegWidth, towerPortalHalfSpan * 2 + towerSectionDepth],
        [centerX + lean, deckTop + towerHeight, 0],
        '#62c6df', 'Torres · pórticos', 'box', [0, 0, 0], 0.62);

      if (enabled.has('stay_cable')) {
        const cablesPerFan = (specification.stayCableCount ?? 40) / 8;
        for (const side of [-1, 1]) {
          for (const direction of [-1, 1]) {
            for (let cableIndex = 0; cableIndex < cablesPerFan; cableIndex += 1) {
              const ratio = (cableIndex + 1) / (cablesPerFan + 1);
              const reach = direction === inward
                ? (cableStayed?.towerSpacingM ?? length * 0.36) / 2
                : (length - (cableStayed?.towerSpacingM ?? length * 0.36)) / 2;
              const deckX = (station + direction * reach * ratio) * scale;
              addCable(`StayCable_${towerIndex + 1}_${side}_${direction}_${cableIndex + 1}`,
                [centerX + lean, deckTop + towerHeight * 0.94, side * towerPortalHalfSpan],
                [deckX, deckTop - deckThickness * 0.15, side * width * 0.34 * scale],
                cableDiameter / 2);
            }
          }
        }
      }
    });

    if (enabled.has('abutment')) {
      for (const [index, x] of [-length / 2, length / 2].entries()) {
        const abutmentHeight = deckTop * 0.7;
        add(`Abutment_${index === 0 ? 'Left' : 'Right'}`,
          [Math.max(1.5, length * 0.02) * scale, abutmentHeight, widthInScene],
          [x * scale, abutmentHeight / 2, 0],
          '#8199a8', 'Estribos conceptuales', 'box', [0, 0, 0], 0.65);
      }
    }

    if (enabled.has('guardrail')) {
      for (const side of [-1, 1]) {
        add(`Guardrail_${side < 0 ? 'Left' : 'Right'}`,
          [lengthInScene, 0.12 * scale, 0.12 * scale],
          [0, deckTop + railHeight - 0.06 * scale, side * widthInScene * 0.47],
          '#9beeff', 'Barandas', 'box', [0, 0, 0], 0.75);
        const postSpacing = Math.max(1, Math.min(2, length / 60)) * scale;
        const postCount = Math.ceil(lengthInScene / postSpacing);
        for (let index = 0; index <= postCount; index += 1) {
          const x = -lengthInScene / 2 + lengthInScene * index / postCount;
          add(`Guardrail_Post_${side}_${String(index + 1).padStart(3, '0')}`,
            [0.08 * scale, railHeight, 0.08 * scale],
            [x, deckTop + railHeight / 2, side * widthInScene * 0.47],
            '#62c6df', 'Barandas', 'box', [0, 0, 0], 0.7);
        }
      }
    }
    return objects;
  }

  if (specification.structureType === 'beam' && enabled.has('main_girder')) {
    const girderCount = Math.max(2, Math.floor(width / 3));
    for (let index = 0; index < girderCount; index += 1) {
      const z = girderCount === 1 ? 0 : (-width * 0.36 + (width * 0.72 * index) / (girderCount - 1)) * scale;
      add(`Main_Girder_${String(index + 1).padStart(2, '0')}`,
        [lengthInScene, girderHeight, girderWidth],
        [0, deckBottom - girderHeight / 2, z],
        materialColors.steel);
    }
  }

  if (enabled.has('cross_beam') && specification.structureType === 'beam') {
    const beamCount = Math.max(2, Math.ceil(length / 6));
    for (let index = 0; index <= beamCount; index += 1) {
      const x = (-length / 2 + (length * index) / beamCount) * scale;
      add(`Cross_Beam_${String(index + 1).padStart(2, '0')}`,
        [Math.max(0.25, Math.min(0.5, length * 0.015)) * scale, girderHeight * 0.7, widthInScene * 0.84],
        [x, deckBottom - girderHeight * 0.35, 0],
        materialColors.steel);
    }
  }

  if (enabled.has('support') && specification.supports.quantity) {
    const quantity = specification.supports.quantity;
    if (specification.supports.distribution === 'paired_across_width' && quantity % 2 !== 0) {
      throw new Error('La distribución en pares requiere una cantidad par de apoyos.');
    }
    const pairCount = specification.supports.distribution === 'paired_across_width' ? quantity / 2 : quantity;
    const positions = Array.from({ length: pairCount }, (_, index) => (
      pairCount === 1 ? 0 : (-length / 2 + (length * (index + 1)) / (pairCount + 1))
    ));
    const supportWidth = (specification.supports.widthM ?? Math.max(0.7, Math.min(1.5, width * 0.12))) * scale;
    const supportDepth = (specification.supports.depthM ?? Math.max(0.7, Math.min(1.5, width * 0.12))) * scale;
    let supportIndex = 0;
    for (const x of positions) {
      const sides = specification.supports.distribution === 'paired_across_width'
        ? [-width * 0.32, width * 0.32]
        : [0];
      for (const z of sides) {
        supportIndex += 1;
        const height = supportTop;
        add(`Support_${String(supportIndex).padStart(2, '0')}`,
          [supportWidth, height, supportDepth],
          [x * scale, height / 2, z * scale],
          specification.supports.material === 'steel' ? materialColors.steel : materialColors.concrete);
      }
    }
  }

  if (enabled.has('abutment')) {
    const abutmentHeight = supportTop;
    for (const [index, x] of [-length / 2, length / 2].entries()) {
      add(`Abutment_${index === 0 ? 'Left' : 'Right'}`,
        [Math.max(0.8, length * 0.025) * scale, abutmentHeight, widthInScene],
        [x * scale, abutmentHeight / 2, 0],
        materialColors.concrete);
    }
  }

  if (enabled.has('guardrail')) {
    const railHeight = Math.max(0.9, Math.min(1.2, width * 0.1)) * scale;
    for (const [index, side] of [-1, 1].entries()) {
      add(`Guardrail_${index === 0 ? 'Left' : 'Right'}`,
        [lengthInScene, 0.12 * scale, 0.12 * scale],
        [0, deckTop + railHeight / 2, side * widthInScene * 0.48],
        materialColors.steel);
    }
  }

  return objects;
}

export function createScene(projectId: string, projectName: string): BridgeSceneDocument {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    projectId,
    name: projectName,
    bridgeType: null,
    unit: 'm',
    gridSize: 1,
    groups: [],
    objects: [],
    updatedAt: new Date().toISOString(),
  };
}

export function cloneScene(scene: BridgeSceneDocument): BridgeSceneDocument {
  return structuredClone(scene);
}

export function convertSceneUnits(scene: BridgeSceneDocument, unit: BridgeUnit): BridgeSceneDocument {
  const scale: Record<BridgeUnit, number> = { m: 1, cm: 100, mm: 1000 };
  const ratio = scale[unit] / scale[scene.unit];
  if (ratio === 1) return scene;
  return {
    ...scene,
    unit,
    gridSize: scene.gridSize * ratio,
    objects: scene.objects.map((object) => ({
      ...object,
      dimensions: object.dimensions.map((value) => value * ratio) as [number, number, number],
      position: object.position.map((value) => value * ratio) as [number, number, number],
      ...(object.geometry ? {
        geometry: {
          ...object.geometry,
          positions: object.geometry.positions.map((value) => value * ratio),
        },
      } : {}),
    })),
  };
}

export function transformBridgeObjects(
  objects: BridgeObject[],
  objectIds: string[],
  delta: {
    position: [number, number, number];
    rotationDegrees: [number, number, number];
    scaleFactor: [number, number, number];
  },
): BridgeObject[] {
  const values = [...delta.position, ...delta.rotationDegrees, ...delta.scaleFactor];
  if (!values.every(Number.isFinite) || delta.scaleFactor.some((value) => value <= 0)) {
    throw new Error('Las transformaciones deben usar valores finitos y factores de escala mayores que cero.');
  }
  const selectedIds = new Set(objectIds);
  return objects.map((object) => {
    if (!selectedIds.has(object.id) || object.locked) return object;
    return {
      ...object,
      position: object.position.map((value, index) => value + delta.position[index]) as [number, number, number],
      rotation: object.rotation.map((value, index) => value + delta.rotationDegrees[index] * Math.PI / 180) as [number, number, number],
      scale: object.scale.map((value, index) => value * delta.scaleFactor[index]) as [number, number, number],
    };
  });
}
