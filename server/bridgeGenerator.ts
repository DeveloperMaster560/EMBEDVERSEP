/**
 * API local de generación de puentes.
 *
 * El transporte, el aislamiento del proceso y los límites están en
 * `generatorRuntime`, compartidos con el generador de edificios. Aquí solo vive
 * la validación de la especificación de puente.
 *
 * Los rangos reproducen los del generador (`tools/building_generator/
 * bridge_params.py`) para rechazar pronto lo imposible. Lo que depende de
 * dimensiones derivadas —luz máxima por tipología, calzada útil tras aceras,
 * hueco bajo el tablero— lo comprueba el generador, que es quien las conoce, y
 * devuelve 422 con el motivo.
 */

import {
  GenerateRequestError,
  createGeneratorMiddleware,
  requireBoolean,
  requireDisciplines,
  requireFiniteInRange,
  requireInteger,
  requireShortText,
  runGeneratorScript,
  type GenerateOutcome,
} from './generatorRuntime.js';
import type { Connect } from 'vite';

export { GenerateRequestError } from './generatorRuntime.js';

const SCRIPT = 'generate_bridge_scene.py';

const MIN_LENGTH_M = 10;
const MAX_LENGTH_M = 600;
const MIN_WIDTH_M = 4;
const MAX_WIDTH_M = 40;
const MIN_DECK_HEIGHT_M = 1.5;
const MAX_DECK_HEIGHT_M = 120;
const MIN_SPANS = 1;
const MAX_SPANS = 20;

const ALLOWED_TYPES = new Set(['beam', 'slab', 'cable_stayed']);

const ALLOWED_DISCIPLINES = new Set([
  'structure',
  'deck',
  'barriers',
  'drainage',
  'lighting',
  'signage',
  'instrumentation',
]);

export interface BridgeGeneratorSpec {
  bridge_type?: string;
  length_m?: number;
  width_m?: number;
  deck_height_m?: number;
  span_count?: number;
  girder_count?: number;
  lanes?: number;
  sidewalks?: boolean;
  project_name?: string;
  disciplines?: string[];
}

/** Valida y normaliza la especificación. Rechaza todo lo que no reconoce. */
export function validateBridgeSpec(value: unknown): BridgeGeneratorSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GenerateRequestError('El cuerpo de la solicitud no es válido.', 400, 'INVALID_REQUEST');
  }
  const input = value as Record<string, unknown>;
  const spec: BridgeGeneratorSpec = {};

  if (input.bridge_type !== undefined) {
    const type = input.bridge_type;
    if (typeof type !== 'string' || !ALLOWED_TYPES.has(type)) {
      throw new GenerateRequestError(
        `Tipología de puente no reconocida: ${String(type)}. El generador cubre vigas, losa y atirantado.`,
        400,
        'INVALID_BRIDGE_TYPE',
      );
    }
    spec.bridge_type = type;
  }
  if (input.length_m !== undefined) {
    spec.length_m = requireFiniteInRange(input.length_m, 'La longitud', MIN_LENGTH_M, MAX_LENGTH_M);
  }
  if (input.width_m !== undefined) {
    spec.width_m = requireFiniteInRange(input.width_m, 'El ancho de tablero', MIN_WIDTH_M, MAX_WIDTH_M);
  }
  if (input.deck_height_m !== undefined) {
    spec.deck_height_m = requireFiniteInRange(
      input.deck_height_m,
      'La cota del tablero',
      MIN_DECK_HEIGHT_M,
      MAX_DECK_HEIGHT_M,
    );
  }
  if (input.span_count !== undefined) {
    spec.span_count = requireInteger(input.span_count, 'El número de vanos', MIN_SPANS, MAX_SPANS);
  }
  if (input.girder_count !== undefined) {
    spec.girder_count = requireInteger(input.girder_count, 'El número de vigas principales', 2, 12);
  }
  if (input.lanes !== undefined) {
    spec.lanes = requireInteger(input.lanes, 'El número de carriles', 1, 8);
  }
  if (input.sidewalks !== undefined) {
    spec.sidewalks = requireBoolean(input.sidewalks, 'La presencia de aceras');
  }
  if (input.project_name !== undefined) {
    spec.project_name = requireShortText(input.project_name, 'project_name');
  }
  if (input.disciplines !== undefined) {
    spec.disciplines = requireDisciplines(input.disciplines, ALLOWED_DISCIPLINES);
  }
  return spec;
}

export async function runBridgeGenerator(
  spec: BridgeGeneratorSpec,
  rootDirectory: string,
): Promise<GenerateOutcome> {
  return await runGeneratorScript(spec as Record<string, unknown>, rootDirectory, SCRIPT);
}

export function createBridgeGeneratorMiddleware(
  rootDirectory: string,
): Connect.NextHandleFunction {
  return createGeneratorMiddleware(rootDirectory, {
    script: SCRIPT,
    validate: (value) => validateBridgeSpec(value) as Record<string, unknown>,
  });
}
