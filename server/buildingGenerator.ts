/**
 * API local de generación de edificios.
 *
 * El transporte, el aislamiento del proceso y los límites están en
 * `generatorRuntime`. Aquí solo vive la validación de la especificación de
 * edificio: qué campos existen, en qué rango y con qué vocabulario.
 */

import {
  GenerateRequestError,
  createGeneratorMiddleware,
  requireDisciplines,
  requireFiniteInRange,
  requireInteger,
  requireShortText,
  runGeneratorScript,
  type GenerateOutcome,
} from './generatorRuntime.js';
import type { Connect } from 'vite';

export { GenerateRequestError, pythonCandidates } from './generatorRuntime.js';

const MIN_LEVELS = 1;
const MAX_LEVELS = 12;
const MIN_SIDE_M = 15;
const MAX_SIDE_M = 120;

const SCRIPT = 'generate_scene.py';

const ALLOWED_DISCIPLINES = new Set([
  'architecture',
  'structure',
  'electrical',
  'telecommunications',
  'hydrosanitary',
  'hvac',
  'security',
]);

const ALLOWED_ROOM_USES = new Set([
  'oficina', 'sala_reuniones', 'sala_juntas', 'recepcion', 'bano', 'aseo',
  'cuarto_electrico', 'cuarto_telecom', 'cuarto_hvac', 'zona_tecnica',
  'archivo', 'laboratorio', 'aula', 'deposito',
]);

const ALLOWED_BANDS = new Set(['SOUTH', 'NORTH', 'WEST', 'EAST']);

export interface GeneratorSpec {
  levels?: number;
  length_x_m?: number;
  width_y_m?: number;
  clear_height_m?: number;
  floor_to_floor_m?: number;
  corridor_width_m?: number;
  core_size_m?: [number, number];
  project_name?: string;
  building_use?: string;
  disciplines?: string[];
  rooms_by_band?: Record<string, Record<string, number>>;
}

/** Valida y normaliza la especificación. Rechaza todo lo que no reconoce. */
export function validateGeneratorSpec(value: unknown): GeneratorSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GenerateRequestError('El cuerpo de la solicitud no es válido.', 400, 'INVALID_REQUEST');
  }
  const input = value as Record<string, unknown>;
  const spec: GeneratorSpec = {};

  if (input.levels !== undefined) {
    spec.levels = requireInteger(input.levels, 'El número de niveles', MIN_LEVELS, MAX_LEVELS);
  }
  if (input.length_x_m !== undefined) {
    spec.length_x_m = requireFiniteInRange(input.length_x_m, 'La longitud', MIN_SIDE_M, MAX_SIDE_M);
  }
  if (input.width_y_m !== undefined) {
    spec.width_y_m = requireFiniteInRange(input.width_y_m, 'El ancho', MIN_SIDE_M, MAX_SIDE_M);
  }
  if (input.clear_height_m !== undefined) {
    spec.clear_height_m = requireFiniteInRange(input.clear_height_m, 'La altura libre', 2.2, 6);
  }
  if (input.floor_to_floor_m !== undefined) {
    spec.floor_to_floor_m = requireFiniteInRange(input.floor_to_floor_m, 'La altura entre niveles', 2.5, 7);
  }
  if (input.corridor_width_m !== undefined) {
    spec.corridor_width_m = requireFiniteInRange(input.corridor_width_m, 'El ancho de circulación', 1.2, 6);
  }
  if (input.core_size_m !== undefined) {
    const core = input.core_size_m;
    if (!Array.isArray(core) || core.length !== 2) {
      throw new GenerateRequestError('El núcleo debe indicarse como [ancho, fondo].', 400, 'INVALID_CORE');
    }
    spec.core_size_m = [
      requireFiniteInRange(core[0], 'El ancho del núcleo', 3, 20),
      requireFiniteInRange(core[1], 'El fondo del núcleo', 3, 20),
    ];
  }
  for (const key of ['project_name', 'building_use'] as const) {
    if (input[key] !== undefined) spec[key] = requireShortText(input[key], key);
  }
  if (input.disciplines !== undefined) {
    spec.disciplines = requireDisciplines(input.disciplines, ALLOWED_DISCIPLINES);
  }
  if (input.rooms_by_band !== undefined) {
    const rooms = input.rooms_by_band;
    if (!rooms || typeof rooms !== 'object' || Array.isArray(rooms)) {
      throw new GenerateRequestError('El programa de recintos no es válido.', 400, 'INVALID_ROOMS');
    }
    const out: Record<string, Record<string, number>> = {};
    for (const [band, uses] of Object.entries(rooms as Record<string, unknown>)) {
      if (!ALLOWED_BANDS.has(band)) {
        throw new GenerateRequestError(`Banda no reconocida: ${band}`, 400, 'INVALID_BAND');
      }
      if (!uses || typeof uses !== 'object' || Array.isArray(uses)) {
        throw new GenerateRequestError(`El contenido de la banda ${band} no es válido.`, 400, 'INVALID_ROOMS');
      }
      const bucket: Record<string, number> = {};
      for (const [use, qty] of Object.entries(uses as Record<string, unknown>)) {
        if (!ALLOWED_ROOM_USES.has(use)) {
          throw new GenerateRequestError(`Uso de recinto no reconocido: ${use}`, 400, 'INVALID_ROOM_USE');
        }
        const n = requireFiniteInRange(qty, `La cantidad de ${use}`, 1, 40);
        bucket[use] = Math.round(n);
      }
      out[band] = bucket;
    }
    spec.rooms_by_band = out;
  }
  return spec;
}

export async function runGenerator(
  spec: GeneratorSpec,
  rootDirectory: string,
): Promise<GenerateOutcome> {
  return await runGeneratorScript(spec as Record<string, unknown>, rootDirectory, SCRIPT);
}

export function createBuildingGeneratorMiddleware(
  rootDirectory: string,
): Connect.NextHandleFunction {
  return createGeneratorMiddleware(rootDirectory, {
    script: SCRIPT,
    validate: (value) => validateGeneratorSpec(value) as Record<string, unknown>,
  });
}
