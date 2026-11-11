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

const ALLOWED_TYPES = new Set(['beam', 'slab', 'cable_stayed', 'arch']);

const MAX_TOWER_HEIGHT_M = 400;

/**
 * Campos admitidos del emplazamiento. Es una lista blanca: lo que no está
 * aquí no viaja al generador. Cada entrada declara cómo se valida, porque un
 * texto libre y una latitud no se comprueban igual.
 */
const SITE_TEXT_FIELDS = [
  'country', 'region', 'municipality', 'description', 'crosses',
  'coordinate_system', 'seismic_hazard_zone', 'soil_profile_type',
] as const;

const SITE_NUMERIC_FIELDS: Record<string, [number, number]> = {
  latitude_deg: [-90, 90],
  longitude_deg: [-180, 180],
  ground_elevation_m: [-500, 6000],
  design_wind_speed_kmh: [0, 400],
  rainfall_intensity_mm_h: [0, 500],
};

const ALLOWED_DISCIPLINES = new Set([
  'structure',
  'deck',
  'barriers',
  'drainage',
  'lighting',
  'signage',
  'instrumentation',
  'control',
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
  span_lengths?: number[];
  tower_height_m?: number;
  abutment_height_m?: number;
  instrumentation_layout?: string;
  site?: Record<string, unknown>;
}

/**
 * Valida el emplazamiento declarado.
 *
 * No completa nada: un campo ausente se queda ausente y el generador lo
 * contará como pendiente. La procedencia se admite como texto corto por
 * campo, para que un dato publicado nunca se confunda con uno levantado.
 */
function requireSite(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GenerateRequestError(
      'El emplazamiento debe ser un objeto.', 400, 'INVALID_SITE',
    );
  }
  const input = value as Record<string, unknown>;
  const site: Record<string, unknown> = {};
  for (const key of SITE_TEXT_FIELDS) {
    if (input[key] !== undefined && input[key] !== null) {
      site[key] = requireShortText(input[key], `site.${key}`);
    }
  }
  for (const [key, [min, max]] of Object.entries(SITE_NUMERIC_FIELDS)) {
    if (input[key] !== undefined && input[key] !== null) {
      site[key] = requireFiniteInRange(input[key], `site.${key}`, min, max);
    }
  }
  if (input.provenance !== undefined && input.provenance !== null) {
    const raw = input.provenance;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new GenerateRequestError(
        'site.provenance debe ser un objeto campo → origen.', 400, 'INVALID_SITE',
      );
    }
    const provenance: Record<string, string> = {};
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > 40) {
      throw new GenerateRequestError(
        'site.provenance declara demasiados campos.', 400, 'INVALID_SITE',
      );
    }
    for (const [key, origin] of entries) {
      provenance[requireShortText(key, 'site.provenance')] =
        requireShortText(origin, `site.provenance.${key}`);
    }
    site.provenance = provenance;
  }
  return site;
}

/** Valida y normaliza la especificación. Rechaza todo lo que no reconoce. */
/** Debe coincidir con INSTRUMENTATION_LAYOUTS de bridge_params.py. */
const INSTRUMENTATION_LAYOUTS = ['generic', 'shm-novena-2026-11'];

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
        `Tipología de puente no reconocida: ${String(type)}. `
        + 'El generador cubre vigas, losa, atirantado y arco.',
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
  if (input.span_lengths !== undefined) {
    const raw = input.span_lengths;
    if (!Array.isArray(raw)) {
      throw new GenerateRequestError(
        'span_lengths debe ser una lista de longitudes de vano.', 400, 'INVALID_SPAN_LENGTHS',
      );
    }
    if (raw.length < MIN_SPANS || raw.length > MAX_SPANS) {
      throw new GenerateRequestError(
        `span_lengths debe declarar entre ${MIN_SPANS} y ${MAX_SPANS} vanos.`,
        400,
        'INVALID_SPAN_LENGTHS',
      );
    }
    spec.span_lengths = raw.map((item, index) =>
      requireFiniteInRange(item, `El vano ${index + 1}`, 0.5, MAX_LENGTH_M));
  }
  if (input.tower_height_m !== undefined) {
    spec.tower_height_m = requireFiniteInRange(
      input.tower_height_m, 'La altura de torre sobre el tablero', 0.5, MAX_TOWER_HEIGHT_M,
    );
  }
  // La altura del estribo es un dato del TERRENO, no del tablero. Si no se
  // declara, el generador la acota y lo advierte, en vez de llevar el muro
  // hasta el plano de referencia.
  if (input.abutment_height_m !== undefined) {
    spec.abutment_height_m = requireFiniteInRange(
      input.abutment_height_m, 'La altura del estribo', 0.5, 60,
    );
  }
  if (input.instrumentation_layout !== undefined) {
    if (!INSTRUMENTATION_LAYOUTS.includes(input.instrumentation_layout as string)) {
      throw new GenerateRequestError(
        `instrumentation_layout debe ser uno de: ${INSTRUMENTATION_LAYOUTS.join(', ')}.`,
        400, 'INVALID_INSTRUMENTATION_LAYOUT',
      );
    }
    spec.instrumentation_layout = input.instrumentation_layout as string;
  }
  if (input.site !== undefined) {
    spec.site = requireSite(input.site);
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
