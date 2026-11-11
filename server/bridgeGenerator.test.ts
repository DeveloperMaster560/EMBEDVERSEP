import { describe, expect, it } from 'vitest';

import { GenerateRequestError, validateBridgeSpec } from './bridgeGenerator';

function expectRejection(value: unknown, code: string): void {
  try {
    validateBridgeSpec(value);
    throw new Error(`Se esperaba el rechazo ${code} y no ocurrió.`);
  } catch (error) {
    expect(error).toBeInstanceOf(GenerateRequestError);
    expect((error as GenerateRequestError).code).toBe(code);
  }
}

describe('validateBridgeSpec', () => {
  it('acepta una especificación completa y la normaliza', () => {
    const spec = validateBridgeSpec({
      bridge_type: 'beam',
      length_m: 90,
      width_m: 10,
      deck_height_m: 7,
      span_count: 3,
      girder_count: 4,
      lanes: 2,
      sidewalks: true,
      disciplines: ['structure', 'deck', 'structure'],
      project_name: 'Puente de prueba',
    });
    expect(spec.bridge_type).toBe('beam');
    expect(spec.span_count).toBe(3);
    expect(spec.sidewalks).toBe(true);
    expect(spec.disciplines).toEqual(['structure', 'deck']);
  });

  it('acepta un cuerpo vacío y deja que el generador use sus valores por defecto', () => {
    expect(validateBridgeSpec({})).toEqual({});
  });

  it('rechaza un cuerpo que no es objeto', () => {
    expectRejection('texto', 'INVALID_REQUEST');
    expectRejection([1, 2], 'INVALID_REQUEST');
    expectRejection(null, 'INVALID_REQUEST');
  });

  it('rechaza tipologías que el generador no cubre', () => {
    expectRejection({ bridge_type: 'colgante' }, 'INVALID_BRIDGE_TYPE');
    expectRejection({ bridge_type: 7 }, 'INVALID_BRIDGE_TYPE');
    for (const type of ['beam', 'slab', 'cable_stayed']) {
      expect(validateBridgeSpec({ bridge_type: type }).bridge_type).toBe(type);
    }
  });

  it('rechaza dimensiones fuera del rango que resuelve el generador', () => {
    expectRejection({ length_m: 5 }, 'OUT_OF_RANGE');
    expectRejection({ length_m: 900 }, 'OUT_OF_RANGE');
    expectRejection({ width_m: 2 }, 'OUT_OF_RANGE');
    expectRejection({ width_m: 60 }, 'OUT_OF_RANGE');
    expectRejection({ deck_height_m: 0.5 }, 'OUT_OF_RANGE');
    expectRejection({ length_m: Number.NaN }, 'INVALID_NUMBER');
    expectRejection({ width_m: Number.POSITIVE_INFINITY }, 'INVALID_NUMBER');
  });

  it('exige enteros en los conteos', () => {
    expectRejection({ span_count: 2.5 }, 'INVALID_NUMBER');
    expectRejection({ girder_count: 3.5 }, 'INVALID_NUMBER');
    expectRejection({ lanes: 1.5 }, 'INVALID_NUMBER');
    expectRejection({ span_count: 0 }, 'OUT_OF_RANGE');
    expectRejection({ span_count: 40 }, 'OUT_OF_RANGE');
    expectRejection({ girder_count: 1 }, 'OUT_OF_RANGE');
  });

  it('exige un booleano en las aceras: no admite "sí" ni 1', () => {
    expectRejection({ sidewalks: 'si' }, 'INVALID_BOOLEAN');
    expectRejection({ sidewalks: 1 }, 'INVALID_BOOLEAN');
    expect(validateBridgeSpec({ sidewalks: false }).sidewalks).toBe(false);
  });

  it('rechaza disciplinas desconocidas y la lista vacía', () => {
    expectRejection({ disciplines: ['paisajismo'] }, 'INVALID_DISCIPLINE');
    expectRejection({ disciplines: ['hvac'] }, 'INVALID_DISCIPLINE');
    expectRejection({ disciplines: [] }, 'INVALID_DISCIPLINES');
  });

  it('rechaza texto excesivo y limpia caracteres de control', () => {
    expectRejection({ project_name: 'x'.repeat(200) }, 'INVALID_TEXT');
    const spec = validateBridgeSpec({ project_name: 'Puente\u0000 Norte\u001f' });
    expect(spec.project_name).toBe('Puente Norte');
  });

  it('no deja pasar propiedades que no reconoce', () => {
    const spec = validateBridgeSpec({ length_m: 60, comando: 'rm -rf /', __proto__: {} });
    expect(spec).toEqual({ length_m: 60 });
    expect(Object.keys(spec)).not.toContain('comando');
  });

  it('acepta solo las disposiciones de instrumentación que conoce el generador', () => {
    expect(validateBridgeSpec({ instrumentation_layout: 'shm-novena-2026-11' }).instrumentation_layout)
      .toBe('shm-novena-2026-11');
    expect(() => validateBridgeSpec({ instrumentation_layout: 'inventada' })).toThrow(GenerateRequestError);
  });
});
