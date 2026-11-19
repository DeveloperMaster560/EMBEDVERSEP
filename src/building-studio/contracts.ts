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
  | 'vivienda'
  | 'desconocido';

/** Recintos de una vivienda. Debe coincidir con RESIDENTIAL_ROOM_TYPES de params.py. */
export type ResidentialRoomUse =
  | 'sala'
  | 'comedor'
  | 'cocina'
  | 'dormitorio'
  | 'bano'
  | 'estudio'
  | 'lavanderia';

/** Disciplinas que el generador cubre en vivienda (generate_scene.py). */
export const RESIDENTIAL_DISCIPLINES: readonly DisciplineKey[] = [
  'architecture', 'structure', 'electrical',
];

/**
 * Límites de planta. El generador construye dos tipologías y cada una tiene su
 * mínimo geométrico: la de oficinas (núcleo central, anillo de circulación y
 * cuatro bandas) necesita 15 m de lado; la de vivienda, el mínimo lo calcula
 * el generador según la escalera, y aquí solo se descarta lo que ninguna de las
 * dos puede construir. Deben coincidir con server/buildingGenerator.ts.
 */
export const BUILDING_LIMITS = {
  minSideM: 5,
  maxSideM: 120,
  minSideOfficeM: 15,
  minLevels: 1,
  maxLevels: 12,
} as const;

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
  /**
   * Programa de una vivienda: cuántos recintos de cada uso en TODA la casa.
   * Solo los que el usuario nombra; el generador no añade ninguno.
   */
  residentialProgram?: Partial<Record<ResidentialRoomUse, number>>;
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
  if (spec.buildingUse === 'vivienda' && spec.residentialProgram
      && Object.keys(spec.residentialProgram).length > 0) {
    out.residential_program = spec.residentialProgram;
  }
  out.disciplines = spec.disciplines;
  return out;
}

/** Comprobación mínima antes de enviar la solicitud al generador. */
export function validateSpecification(spec: BuildingSpecification): string[] {
  const problems: string[] = [];
  if (spec.schemaVersion !== 1) problems.push('Versión de esquema no soportada.');
  const L = BUILDING_LIMITS;
  if (spec.levels !== null && (spec.levels < L.minLevels || spec.levels > L.maxLevels)) {
    problems.push(`El número de niveles debe estar entre ${L.minLevels} y ${L.maxLevels}.`);
  }
  // Mismos mensajes que el servidor (requireFiniteInRange), para que el
  // usuario lea lo mismo tanto si lo para el cliente como si lo para el API.
  const residential = spec.buildingUse === 'vivienda';
  for (const [label, value] of [
    ['La longitud', spec.lengthXM],
    ['El ancho', spec.widthYM],
  ] as const) {
    if (value === null) continue;
    if (!Number.isFinite(value) || value <= 0) {
      problems.push(`${label} debe ser un número positivo.`);
    } else if (value < L.minSideM || value > L.maxSideM) {
      problems.push(`${label} debe estar entre ${L.minSideM} y ${L.maxSideM}.`);
    } else if (!residential && value < L.minSideOfficeM) {
      problems.push(
        `${label} de ${value} m es menor que los ${L.minSideOfficeM} m que necesita la tipología de oficinas (núcleo, anillo de circulación y bandas). Si es una casa, indica «casa» o «vivienda».`,
      );
    }
  }
  if (residential) {
    const unsupported = spec.disciplines.filter((d) => !RESIDENTIAL_DISCIPLINES.includes(d));
    if (unsupported.length > 0 && spec.disciplines.length < 7) {
      problems.push(
        `En vivienda el generador cubre estructura, arquitectura y eléctrica; no modela todavía: ${unsupported.join(', ')}.`,
      );
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
