import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GenerateRequestError,
  pythonCandidates,
  validateGeneratorSpec,
} from './buildingGenerator';

function expectRejection(value: unknown, code: string): void {
  try {
    validateGeneratorSpec(value);
    throw new Error(`Se esperaba el rechazo ${code} y no ocurrió.`);
  } catch (error) {
    expect(error).toBeInstanceOf(GenerateRequestError);
    expect((error as GenerateRequestError).code).toBe(code);
  }
}

describe('validateGeneratorSpec', () => {
  it('acepta una especificación completa y la normaliza', () => {
    const spec = validateGeneratorSpec({
      levels: 3,
      length_x_m: 24,
      width_y_m: 18,
      clear_height_m: 3.2,
      floor_to_floor_m: 3.6,
      disciplines: ['structure', 'architecture', 'structure'],
      rooms_by_band: { SOUTH: { aula: 2 } },
      project_name: 'Edificio de prueba',
    });
    expect(spec.levels).toBe(3);
    expect(spec.disciplines).toEqual(['structure', 'architecture']);
    expect(spec.rooms_by_band?.SOUTH?.aula).toBe(2);
  });

  it('acepta un cuerpo vacío y deja que el generador use sus valores por defecto', () => {
    expect(validateGeneratorSpec({})).toEqual({});
  });

  it('rechaza un cuerpo que no es objeto', () => {
    expectRejection('texto', 'INVALID_REQUEST');
    expectRejection([1, 2], 'INVALID_REQUEST');
    expectRejection(null, 'INVALID_REQUEST');
  });

  it('rechaza niveles fuera de rango o no enteros', () => {
    expectRejection({ levels: 0 }, 'OUT_OF_RANGE');
    expectRejection({ levels: 40 }, 'OUT_OF_RANGE');
    expectRejection({ levels: 2.5 }, 'INVALID_NUMBER');
    expectRejection({ levels: 'tres' }, 'INVALID_NUMBER');
  });

  it('rechaza dimensiones fuera del rango que el generador puede resolver', () => {
    expectRejection({ length_x_m: 5 }, 'OUT_OF_RANGE');
    expectRejection({ width_y_m: 500 }, 'OUT_OF_RANGE');
    expectRejection({ length_x_m: Number.NaN }, 'INVALID_NUMBER');
    expectRejection({ length_x_m: Number.POSITIVE_INFINITY }, 'INVALID_NUMBER');
  });

  it('rechaza alturas imposibles', () => {
    expectRejection({ clear_height_m: 1.0 }, 'OUT_OF_RANGE');
    expectRejection({ floor_to_floor_m: 20 }, 'OUT_OF_RANGE');
  });

  it('rechaza disciplinas y usos de recinto desconocidos', () => {
    expectRejection({ disciplines: ['paisajismo'] }, 'INVALID_DISCIPLINE');
    expectRejection({ disciplines: [] }, 'INVALID_DISCIPLINES');
    expectRejection({ rooms_by_band: { SOUTH: { piscina: 1 } } }, 'INVALID_ROOM_USE');
    expectRejection({ rooms_by_band: { ARRIBA: { aula: 1 } } }, 'INVALID_BAND');
  });

  it('rechaza un núcleo mal formado', () => {
    expectRejection({ core_size_m: [6] }, 'INVALID_CORE');
    expectRejection({ core_size_m: 6 }, 'INVALID_CORE');
    expectRejection({ core_size_m: [6, 100] }, 'OUT_OF_RANGE');
  });

  it('rechaza texto excesivo y limpia caracteres de control', () => {
    expectRejection({ project_name: 'x'.repeat(200) }, 'INVALID_TEXT');
    const spec = validateGeneratorSpec({ project_name: 'Torre\u0000 Norte\u001f' });
    expect(spec.project_name).toBe('Torre Norte');
  });

  it('no deja pasar propiedades que no reconoce', () => {
    const spec = validateGeneratorSpec({ levels: 2, comando: 'rm -rf /', __proto__: {} });
    expect(spec).toEqual({ levels: 2 });
    expect(Object.keys(spec)).not.toContain('comando');
  });
});

describe('resolución del intérprete de Python', () => {
  it('usa el reparto de entorno virtual de cada sistema', () => {
    // Unix: bin/python. Windows: Scripts\python.exe. No es un detalle
    // cosmético: equivocarse deja el generador sin intérprete.
    const unix = pythonCandidates('/raiz', 'linux');
    expect(unix).toContain('/raiz/tools/venv/bin/python');
    expect(unix).toContain('/raiz/.venv/bin/python');

    const windows = pythonCandidates('C:\\raiz', 'win32');
    expect(windows.some((c) => c.includes('Scripts') && c.endsWith('python.exe'))).toBe(true);
    expect(windows.some((c) => c.includes(`venv${path.sep}bin`))).toBe(false);
  });

  it('no ofrece en Windows nombres que allí no funcionan', () => {
    const windows = pythonCandidates('C:\\raiz', 'win32');
    // `/usr/bin/python3` no existe, y `python3` suele ser el acceso directo
    // de la Microsoft Store, que abre la tienda en lugar de ejecutar.
    expect(windows).not.toContain('/usr/bin/python3');
    expect(windows).not.toContain('python3');
    expect(windows).toContain('python');
    expect(windows).toContain('py');
  });

  it('en Unix mantiene los nombres de siempre', () => {
    const unix = pythonCandidates('/raiz', 'darwin');
    expect(unix).toContain('/usr/bin/python3');
    expect(unix).toContain('python3');
    expect(unix).not.toContain('py');
  });

  it('prioriza EMBEDVERSE_PYTHON cuando está definido', () => {
    const previous = process.env.EMBEDVERSE_PYTHON;
    process.env.EMBEDVERSE_PYTHON = '/opt/entorno/bin/python';
    try {
      expect(pythonCandidates('/raiz')[0]).toBe('/opt/entorno/bin/python');
    } finally {
      if (previous === undefined) delete process.env.EMBEDVERSE_PYTHON;
      else process.env.EMBEDVERSE_PYTHON = previous;
    }
  });

  it('incluye los entornos del proyecto antes que el Python del sistema', () => {
    const previous = process.env.EMBEDVERSE_PYTHON;
    delete process.env.EMBEDVERSE_PYTHON;
    try {
      const candidates = pythonCandidates('/raiz');
      expect(candidates[0]).toContain('.venv');
      expect(candidates).toContain('python3');
    } finally {
      if (previous !== undefined) process.env.EMBEDVERSE_PYTHON = previous;
    }
  });
});
