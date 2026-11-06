/**
 * Contrato de solicitud y resultado del generador de edificios.
 *
 * Mismo criterio de honestidad que el resto del sistema: lo que no se puede
 * deducir del enunciado queda en `null` y se enumera en `questions`. Un valor
 * nunca significa "cero" ni "por defecto silencioso": si el generador adopta
 * una hipótesis, aparece en `assumptions`.
 */

export type BuildingUse =
  | 'institucional-administrativo'
  | 'oficinas'
  | 'educativo'
  | 'salud'
  | 'mixto'
  | 'desconocido';

export type BandKey = 'SOUTH' | 'NORTH' | 'WEST' | 'EAST';

export type RoomUse =
  | 'oficina'
  | 'sala_reuniones'
  | 'sala_juntas'
  | 'recepcion'
  | 'bano'
  | 'aseo'
  | 'cuarto_electrico'
  | 'cuarto_telecom'
  | 'cuarto_hvac'
  | 'zona_tecnica'
  | 'archivo'
  | 'laboratorio'
  | 'aula'
  | 'deposito';

/** Solicitud que entiende el generador paramétrico. */
export interface BuildingSpecification {
  schemaVersion: 1;
  projectName: string;
  buildingUse: BuildingUse;
  units: 'm';
  levels: number | null;
  lengthXM: number | null;
  widthYM: number | null;
  clearHeightM: number | null;
  floorToFloorM: number | null;
  corridorWidthM: number | null;
  coreSizeM: [number, number] | null;
  /** Recintos adicionales solicitados explícitamente, por banda de fachada. */
  roomsByBand: Partial<Record<BandKey, Partial<Record<RoomUse, number>>>>;
  disciplines: DisciplineKey[];
  /** Supuestos adoptados para poder construir el modelo. */
  assumptions: string[];
  /** Datos que el enunciado no permite deducir. */
  questions: string[];
  /** Fragmentos del enunciado que el intérprete no supo usar. */
  unrecognized: string[];
}

export type DisciplineKey =
  | 'architecture'
  | 'structure'
  | 'electrical'
  | 'telecommunications'
  | 'hydrosanitary'
  | 'hvac'
  | 'security';

export const ALL_DISCIPLINES: DisciplineKey[] = [
  'architecture',
  'structure',
  'electrical',
  'telecommunications',
  'hydrosanitary',
  'hvac',
  'security',
];

export const DISCIPLINE_LABEL: Record<DisciplineKey, string> = {
  architecture: 'Arquitectura',
  structure: 'Estructura',
  electrical: 'Eléctrico',
  telecommunications: 'Telecomunicaciones',
  hydrosanitary: 'Hidrosanitario',
  hvac: 'Climatización',
  security: 'Seguridad',
};

/**
 * Valores que el generador adoptó realmente, devueltos tras generar.
 *
 * Llegan dentro de `ModelGenerationResult.applied`, que es genérico porque el
 * mismo visor sirve a puentes. Esta interfaz documenta la forma concreta del
 * dominio edificio.
 */
export interface AppliedBuildingParameters {
  levels: number;
  length_x_m: number;
  width_y_m: number;
  clear_height_m: number;
  floor_to_floor_m: number;
  area_per_level_m2: number;
  total_area_m2: number;
  structural_depth_m: number;
  core_size_m: [number, number];
  corridor_width_m: number;
  grid_x: number[];
  grid_y: number[];
  stair_riser_m: number;
  stair_risers_per_flight: number;
}

/** Convierte la especificación al JSON que consume el generador en Python. */
export function toGeneratorSpec(spec: BuildingSpecification): Record<string, unknown> {
  const out: Record<string, unknown> = {
    project_name: spec.projectName,
    building_use: spec.buildingUse,
  };
  if (spec.levels !== null) out.levels = spec.levels;
  if (spec.lengthXM !== null) out.length_x_m = spec.lengthXM;
  if (spec.widthYM !== null) out.width_y_m = spec.widthYM;
  if (spec.clearHeightM !== null) out.clear_height_m = spec.clearHeightM;
  if (spec.floorToFloorM !== null) out.floor_to_floor_m = spec.floorToFloorM;
  if (spec.corridorWidthM !== null) out.corridor_width_m = spec.corridorWidthM;
  if (spec.coreSizeM !== null) out.core_size_m = spec.coreSizeM;
  if (Object.keys(spec.roomsByBand).length > 0) out.rooms_by_band = spec.roomsByBand;
  out.disciplines = spec.disciplines;
  return out;
}

/** Comprobación mínima antes de enviar la solicitud al generador. */
export function validateSpecification(spec: BuildingSpecification): string[] {
  const problems: string[] = [];
  if (spec.schemaVersion !== 1) problems.push('Versión de esquema no soportada.');
  if (spec.levels !== null && (spec.levels < 1 || spec.levels > 12)) {
    problems.push('El número de niveles debe estar entre 1 y 12.');
  }
  for (const [label, value] of [
    ['longitud', spec.lengthXM],
    ['ancho', spec.widthYM],
  ] as const) {
    if (value !== null && (!Number.isFinite(value) || value <= 0)) {
      problems.push(`La ${label} debe ser un número positivo.`);
    }
  }
  if (
    spec.clearHeightM !== null &&
    spec.floorToFloorM !== null &&
    spec.floorToFloorM - spec.clearHeightM < 0.2
  ) {
    problems.push(
      'Entre la altura libre y la altura entre niveles deben quedar al menos 0.20 m para viga y losa.',
    );
  }
  if (spec.disciplines.length === 0) problems.push('Selecciona al menos una disciplina.');
  return problems;
}
