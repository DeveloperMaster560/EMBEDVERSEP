import { describe, expect, it } from 'vitest';
import { convertSceneUnits, createAiBridgeObjects, createBridgeObjects, createPrimitive, createScene, createSensorObject, transformBridgeObjects } from './scene';
import { parseBridgeSpecification } from './ai-contracts';

describe('bridge designer scene model', () => {
  const aiSpec = (overrides: Record<string, unknown> = {}) => parseBridgeSpecification({
    schemaVersion: 1,
    structureType: 'beam',
    bridgeName: 'Puente conceptual',
    units: 'm',
    overallDimensions: { lengthM: 30, widthM: 8, heightM: 15, heightMeaning: 'deck_above_ground', heightReference: 'Terreno' },
    deck: { thicknessM: null },
    supports: { type: 'column', orientation: 'vertical', distribution: 'paired_across_width', quantity: 4, widthM: null, depthM: null, material: 'concrete' },
    components: [
      { id: 'deck', type: 'deck', included: true },
      { id: 'support', type: 'support', included: true },
      { id: 'abutment', type: 'abutment', included: true },
      { id: 'girder', type: 'main_girder', included: true },
      { id: 'cross', type: 'cross_beam', included: true },
      { id: 'guardrail', type: 'guardrail', included: true },
    ],
    assumptions: [],
    unresolvedQuestions: [],
    warnings: [],
    generationStatus: 'ready_for_approval',
    conceptualModel: true,
    ...overrides,
  });

  it('creates independent beam bridge pieces at specified dimensions and support count', () => {
    const objects = createAiBridgeObjects(aiSpec(), 'm');
    const deck = objects.find(({ name }) => name === 'Bridge_Deck');
    const supports = objects.filter(({ name }) => name.startsWith('Support_'));

    expect(deck?.dimensions[0]).toBe(30);
    expect(deck?.dimensions[2]).toBe(8);
    expect(deck?.position[1]).toBeLessThan(15);
    expect(supports).toHaveLength(4);
    expect(new Set(objects.map(({ id }) => id)).size).toBe(objects.length);
    expect(objects.some(({ name }) => name === 'Main_Girder_01')).toBe(true);
    expect(objects.some(({ name }) => name === 'Abutment_Left')).toBe(true);
    expect(objects.every(({ collection }) => collection === 'Puente asistido localmente')).toBe(true);
  });

  it('creates an editable holographic cable-stayed model with cylindrical stays and foundations', () => {
    const specification = aiSpec({
      structureType: 'cable_stayed',
      overallDimensions: {
        lengthM: 180,
        widthM: 12,
        heightM: 25,
        heightMeaning: 'deck_above_ground',
        heightReference: 'Supuesto conceptual',
      },
      stayCableCount: 40,
      cableStayed: {
        towerHeightM: 45,
        towerSpacingM: 60,
        towerSectionWidthM: 3,
        towerSectionDepthM: 4,
        stayCableDiameterM: 0.12,
        mainGirderCount: 2,
        mainGirderHeightM: 2,
        mainGirderWidthM: 0.8,
        crossBeamSpacingM: 6,
        crossBeamWidthM: 0.6,
        crossBeamHeightM: 1,
        foundationLengthM: 10,
        foundationWidthM: 10,
        foundationDepthM: 3,
        guardrailHeightM: 1.2,
      },
      deck: { thicknessM: 1.2 },
      supports: { type: 'column', orientation: 'vertical', distribution: 'unknown', quantity: 0, widthM: null, depthM: null, material: 'concrete' },
      components: [
        { id: 'deck', type: 'deck', included: true },
        { id: 'support', type: 'support', included: true },
        { id: 'abutment', type: 'abutment', included: true },
        { id: 'girder', type: 'main_girder', included: true },
        { id: 'cross', type: 'cross_beam', included: true },
        { id: 'guardrail', type: 'guardrail', included: true },
        { id: 'tower', type: 'tower', included: true },
        { id: 'cables', type: 'stay_cable', included: true },
        { id: 'foundation', type: 'foundation', included: true },
      ],
    });

    const objects = createAiBridgeObjects(specification, 'm');
    const cables = objects.filter(({ name }) => name.startsWith('StayCable_'));
    const girders = objects.filter(({ name }) => name.startsWith('Longitudinal_Girder_'));
    const crossBeams = objects.filter(({ name }) => name.startsWith('Cross_Beam_'));
    const foundations = objects.filter(({ name }) => name.startsWith('Foundation_'));

    expect(objects.filter(({ name }) => name.includes('_Leg_'))).toHaveLength(4);
    expect(objects.find(({ name }) => name === 'Tower_1_Leg_Left')?.dimensions).toEqual([3, 67, 4]);
    expect(objects.find(({ name }) => name === 'Tower_1_Leg_Left')?.position[0]).toBeCloseTo(-29.4375);
    expect(cables).toHaveLength(40);
    expect(cables.every(({ kind, dimensions, opacity }) => kind === 'cylinder' && dimensions[0] === 0.12 && opacity === 0.8)).toBe(true);
    expect(girders).toHaveLength(2);
    expect(girders[0].dimensions).toEqual([180, 2, 0.8]);
    expect(crossBeams).toHaveLength(31);
    expect(crossBeams[0].dimensions).toEqual([0.6, 1, 12]);
    expect(foundations).toHaveLength(4);
    expect(foundations[0].dimensions).toEqual([10, 3, 10]);
    expect(objects.find(({ name }) => name === 'Guardrail_Left')?.position[1]).toBe(25 + 1.2 - 0.06);
    expect(objects.find(({ name }) => name === 'Bridge_Deck')?.opacity).toBeLessThan(1);
    expect(new Set(objects.map(({ id }) => id)).size).toBe(objects.length);
  });

  it('converts meter specifications into the existing scene units', () => {
    const objects = createAiBridgeObjects(aiSpec(), 'mm');
    const deck = objects.find(({ name }) => name === 'Bridge_Deck');
    expect(deck?.dimensions[0]).toBe(30_000);
    expect(deck?.dimensions[2]).toBe(8_000);
    expect(deck?.position[1]).toBe(14_625);
  });

  it('does not generate unresolved specifications or odd support pairs', () => {
    const unresolved = parseBridgeSpecification({
      schemaVersion: 1,
      structureType: 'beam',
      bridgeName: 'Pendiente',
      units: 'm',
      overallDimensions: { lengthM: 30, widthM: 8, heightM: 15, heightMeaning: 'deck_above_ground', heightReference: 'Terreno' },
      deck: { thicknessM: null },
      supports: { type: 'column', orientation: 'vertical', distribution: 'paired_across_width', quantity: 3, widthM: null, depthM: null, material: 'concrete' },
      components: [{ id: 'deck', type: 'deck', included: true }],
      assumptions: [],
      unresolvedQuestions: [],
      warnings: [],
      generationStatus: 'ready_for_approval',
      conceptualModel: true,
    });
    expect(() => createAiBridgeObjects(unresolved, 'm')).toThrow(/aclaración/);
  });

  it('creates a configurable cable-stayed bridge from editable objects', () => {
    const objects = createBridgeObjects({
      name: 'Test',
      type: 'cable-stayed',
      length: 120,
      width: 18,
      deckHeight: 8,
      pierHeight: 7,
      spans: 3,
      lanes: 4,
      unit: 'm',
    });

    expect(objects.some(({ name }) => name === 'Tablero estructural')).toBe(true);
    expect(objects.some(({ name }) => name.startsWith('Pilon'))).toBe(true);
    expect(objects.some(({ name }) => name.startsWith('Tirante'))).toBe(true);
    expect(objects.length).toBeGreaterThan(30);
  });

  it('creates primitive and IoT scene data with persistent association identifiers', () => {
    const primitive = createPrimitive('cylinder');
    const sensor = createSensorObject('mpu6050');
    const scene = createScene('project-1', 'Bridge');

    expect(primitive.dimensions).toEqual([1, 2, 1]);
    expect(scene.projectId).toBe('project-1');
    expect(sensor.kind).toBe('box');
    expect(sensor.role).toBe('iot');
    expect(sensor.association?.status).toBe('unconnected');
    expect(sensor.association?.bridgeComponentId).toBe('');
  });

  it('rejects invalid bridge dimensions instead of generating misleading geometry', () => {
    expect(() => createBridgeObjects({
      name: 'Invalid',
      type: 'beam',
      length: -1,
      width: 8,
      deckHeight: 4,
      pierHeight: 5,
      spans: 2,
      lanes: 2,
      unit: 'm',
    })).toThrow(/Dimensiones inválidas/);
  });

  it('converts displayed scene units without changing relative scale', () => {
    const scene = createScene('project-1', 'Bridge');
    scene.objects.push(createPrimitive('box'));

    const converted = convertSceneUnits(scene, 'cm');

    expect(converted.objects[0].dimensions).toEqual([200, 100, 200]);
    expect(converted.objects[0].scale).toEqual([1, 1, 1]);
    expect(converted.gridSize).toBe(100);
    expect(scene.unit).toBe('m');
  });

  it('applies numeric transforms to selected unlocked objects and preserves locked or unselected objects', () => {
    const first = createPrimitive('box');
    const second = { ...createPrimitive('sphere'), locked: true };
    const untouched = createPrimitive('cone');
    const result = transformBridgeObjects([first, second, untouched], [first.id, second.id], {
      position: [2, 0, -1],
      rotationDegrees: [0, 90, 0],
      scaleFactor: [2, 1, 0.5],
    });

    expect(result[0].position).toEqual([2, first.position[1], -1]);
    expect(result[0].rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(result[0].scale).toEqual([2, 1, 0.5]);
    expect(result[1]).toBe(second);
    expect(result[2]).toBe(untouched);
    expect(() => transformBridgeObjects([first], [first.id], {
      position: [0, 0, 0],
      rotationDegrees: [0, 0, 0],
      scaleFactor: [1, 0, 1],
    })).toThrow(/escala mayores que cero/);
  });

  it('creates recognizable structural elements across the bridge typologies', () => {
    const base = {
      name: 'Test',
      length: 60,
      width: 10,
      deckHeight: 4,
      pierHeight: 5,
      spans: 3,
      lanes: 2,
      unit: 'm' as const,
    };
    const arch = createBridgeObjects({ ...base, type: 'arch' });
    const truss = createBridgeObjects({ ...base, type: 'truss' });
    const suspension = createBridgeObjects({ ...base, type: 'suspension' });

    expect(arch.some(({ name }) => name.startsWith('Arco'))).toBe(true);
    expect(truss.some(({ name }) => name.includes('cercha'))).toBe(true);
    expect(suspension.some(({ name }) => name === 'Cable principal')).toBe(true);
    expect(suspension.some(({ name }) => name === 'Colgante vertical')).toBe(true);
  });
});
