import { describe, expect, it } from 'vitest';
import { canGenerateBridge, describeGenerationBlockers, parseBridgeSpecification } from './ai-contracts';

const validSpecification = {
  schemaVersion: 1,
  structureType: 'beam',
  bridgeName: 'Puente conceptual',
  units: 'm',
  overallDimensions: {
    lengthM: 30,
    widthM: 8,
    heightM: 15,
    heightMeaning: 'deck_above_ground',
    heightReference: 'Terreno',
  },
  deck: { thicknessM: null },
  supports: {
    type: 'column',
    orientation: 'vertical',
    distribution: 'unknown',
    quantity: 4,
    widthM: null,
    depthM: null,
    material: 'concrete',
  },
  components: [
    { id: 'deck', type: 'deck', included: true },
    { id: 'supports', type: 'support', included: true },
    { id: 'girders', type: 'main_girder', included: true },
  ],
  assumptions: [],
  unresolvedQuestions: [],
  warnings: [],
  generationStatus: 'ready_for_approval',
  conceptualModel: true,
};

describe('bridge AI specification', () => {
  it('requires clarification for a missing support layout', () => {
    const specification = parseBridgeSpecification(validSpecification);
    expect(specification.generationStatus).toBe('needs_clarification');
    expect(specification.unresolvedQuestions).toContain(
      '¿Cómo se distribuyen los apoyos: en una fila a lo largo del puente o en pares a ambos lados?',
    );
    expect(canGenerateBridge(specification)).toBe(false);
  });

  it('does not interpret a non-deck height as deck elevation above ground', () => {
    const specification = parseBridgeSpecification({
      ...validSpecification,
      supports: { ...validSpecification.supports, quantity: 0 },
      overallDimensions: { ...validSpecification.overallDimensions, heightMeaning: 'unknown' },
    });
    expect(specification.unresolvedQuestions).toContain('¿Qué altura debe tener el tablero sobre el terreno?');
    expect(canGenerateBridge(specification)).toBe(false);
  });

  it('keeps unspecified dimensions unknown and blocks generation', () => {
    const specification = parseBridgeSpecification({
      ...validSpecification,
      overallDimensions: { ...validSpecification.overallDimensions, lengthM: null },
      supports: { ...validSpecification.supports, quantity: null },
    });
    expect(specification.overallDimensions.lengthM).toBeNull();
    expect(specification.unresolvedQuestions).toContain('¿Cuál es la longitud del puente?');
    expect(specification.unresolvedQuestions).toContain('¿Cuántos apoyos necesitas?');
    expect(canGenerateBridge(specification)).toBe(false);
  });

  it('rejects malformed geometry and accepts the cable-stayed bridge type', () => {
    expect(() => parseBridgeSpecification({ ...validSpecification, overallDimensions: null })).toThrow(/incompleta|inválida/i);
    expect(parseBridgeSpecification({ ...validSpecification, structureType: 'cable_stayed' }).structureType).toBe('cable_stayed');
  });

  it('explica siempre por qué no se puede generar, nunca deja el botón mudo', () => {
    const specification = parseBridgeSpecification({
      ...validSpecification,
      overallDimensions: { ...validSpecification.overallDimensions, lengthM: null },
      supports: { ...validSpecification.supports, quantity: null },
    });
    const blockers = describeGenerationBlockers(specification);
    expect(canGenerateBridge(specification)).toBe(false);
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.some((b) => /apoyos/i.test(b))).toBe(true);
    expect(blockers.some((b) => /longitud/i.test(b))).toBe(true);
  });

  it('el botón y la lista de motivos no pueden divergir', () => {
    const casos = [
      validSpecification,
      { ...validSpecification, supports: { ...validSpecification.supports, quantity: null } },
      { ...validSpecification, supports: { ...validSpecification.supports, quantity: 0 } },
      { ...validSpecification, supports: { ...validSpecification.supports, distribution: 'along_length' } },
      {
        ...validSpecification,
        supports: { ...validSpecification.supports, quantity: 3, distribution: 'paired_across_width' },
      },
      { ...validSpecification, overallDimensions: { ...validSpecification.overallDimensions, widthM: null } },
      {
        ...validSpecification,
        structureType: 'cable_stayed',
        supports: { ...validSpecification.supports, quantity: 0 },
        components: [
          { id: 'deck', type: 'deck', included: true },
          { id: 'tower', type: 'tower', included: true },
          { id: 'cables', type: 'stay_cable', included: true },
        ],
      },
    ];
    for (const caso of casos) {
      const specification = parseBridgeSpecification(caso);
      expect(
        canGenerateBridge(specification),
        `desacuerdo en ${JSON.stringify(caso.supports)}`,
      ).toBe(describeGenerationBlockers(specification).length === 0);
    }
  });

  it('una especificación completa no deja ningún motivo pendiente', () => {
    const specification = parseBridgeSpecification({
      ...validSpecification,
      supports: { ...validSpecification.supports, distribution: 'along_length' },
    });
    expect(describeGenerationBlockers(specification)).toEqual([]);
    expect(canGenerateBridge(specification)).toBe(true);
  });

  it('requires both towers and stay cables before approving cable-stayed geometry', () => {
    const specification = parseBridgeSpecification({
      ...validSpecification,
      structureType: 'cable_stayed',
      supports: { ...validSpecification.supports, quantity: 0 },
      components: [
        { id: 'deck', type: 'deck', included: true },
        { id: 'tower', type: 'tower', included: true },
        { id: 'cables', type: 'stay_cable', included: false },
      ],
    });

    expect(canGenerateBridge(specification)).toBe(false);
  });
});
