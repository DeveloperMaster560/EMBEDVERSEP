/**
 * Contrato de solicitud del generador paramétrico de puentes.
 *
 * Mismo criterio de honestidad que en edificación: lo que no se puede deducir
 * del enunciado queda en `null` y se enumera en `questions`. Un valor nunca
 * significa "cero" ni "por defecto silencioso"; si el intérprete adopta una
 * hipótesis, aparece en `assumptions`.
 *
 * Es un contrato distinto del de `src/bridge-designer`: aquel describe un
 * puente conceptual de visualización, este alimenta al generador paramétrico
 * multidisciplinario de `tools/building_generator/bridge_model.py`.
 */

export type BridgeType = 'beam' | 'slab' | 'cable_stayed';

export const BRIDGE_TYPE_LABEL: Record<BridgeType, string> = {
  beam: 'Puente de vigas',
  slab: 'Puente de losa',
  cable_stayed: 'Puente atirantado',
};

export type BridgeDisciplineKey =
  | 'structure'
  | 'deck'
  | 'barriers'
  | 'drainage'
  | 'lighting'
  | 'signage'
  | 'instrumentation';

export const ALL_BRIDGE_DISCIPLINES: BridgeDisciplineKey[] = [
  'structure',
  'deck',
  'barriers',
  'drainage',
  'lighting',
  'signage',
  'instrumentation',
];

export const BRIDGE_DISCIPLINE_LABEL: Record<BridgeDisciplineKey, string> = {
  structure: 'Estructura',
  deck: 'Tablero y calzada',
  barriers: 'Barreras y defensas',
  drainage: 'Drenaje',
  lighting: 'Iluminación',
  signage: 'Señalización',
  instrumentation: 'Instrumentación',
};

/** Límites que resuelve el generador. Fuera de ellos rechaza la solicitud. */
export const BRIDGE_LIMITS = {
  minLengthM: 10,
  maxLengthM: 600,
  minWidthM: 4,
  maxWidthM: 40,
  minDeckHeightM: 1.5,
  minSpans: 1,
  maxSpans: 20,
  /** Luz máxima conceptual por tipología, en metros. */
  maxSpanLengthM: { beam: 45, slab: 25, cable_stayed: 300 } as Record<BridgeType, number>,
} as const;

export interface BridgeSpecification {
  schemaVersion: 1;
  projectName: string;
  bridgeType: BridgeType;
  units: 'm';
  lengthM: number | null;
  widthM: number | null;
  /** Cota del tablero sobre el terreno. */
  deckHeightM: number | null;
  spanCount: number | null;
  girderCount: number | null;
  lanes: number | null;
  sidewalks: boolean | null;
  disciplines: BridgeDisciplineKey[];
  /** Supuestos adoptados para poder construir el modelo. */
  assumptions: string[];
  /** Datos que el enunciado no permite deducir. */
  questions: string[];
  /** Fragmentos del enunciado que el intérprete no supo usar. */
  unrecognized: string[];
}

/** Convierte la especificación al JSON que consume el generador en Python. */
export function toGeneratorSpec(spec: BridgeSpecification): Record<string, unknown> {
  const out: Record<string, unknown> = {
    project_name: spec.projectName,
    bridge_type: spec.bridgeType,
  };
  if (spec.lengthM !== null) out.length_m = spec.lengthM;
  if (spec.widthM !== null) out.width_m = spec.widthM;
  if (spec.deckHeightM !== null) out.deck_height_m = spec.deckHeightM;
  if (spec.spanCount !== null) out.span_count = spec.spanCount;
  if (spec.girderCount !== null) out.girder_count = spec.girderCount;
  if (spec.lanes !== null) out.lanes = spec.lanes;
  if (spec.sidewalks !== null) out.sidewalks = spec.sidewalks;
  out.disciplines = spec.disciplines;
  return out;
}

/**
 * Comprobación mínima antes de enviar la solicitud.
 *
 * Solo rechaza lo que es imposible en cualquier caso. El resto —luz máxima por
 * tipología, calzada útil tras aceras, hueco bajo el tablero— lo comprueba el
 * generador, que es quien conoce las dimensiones derivadas.
 */
export function validateSpecification(spec: BridgeSpecification): string[] {
  const problems: string[] = [];
  const L = BRIDGE_LIMITS;
  if (spec.schemaVersion !== 1) problems.push('Versión de esquema no soportada.');

  if (spec.lengthM !== null && (spec.lengthM < L.minLengthM || spec.lengthM > L.maxLengthM)) {
    problems.push(`La longitud debe estar entre ${L.minLengthM} y ${L.maxLengthM} m.`);
  }
  if (spec.widthM !== null && (spec.widthM < L.minWidthM || spec.widthM > L.maxWidthM)) {
    problems.push(`El ancho de tablero debe estar entre ${L.minWidthM} y ${L.maxWidthM} m.`);
  }
  if (spec.deckHeightM !== null && spec.deckHeightM < L.minDeckHeightM) {
    problems.push(
      `La cota del tablero debe ser de al menos ${L.minDeckHeightM} m para alojar vigas, apoyos y pilas.`,
    );
  }
  if (spec.spanCount !== null && (spec.spanCount < L.minSpans || spec.spanCount > L.maxSpans)) {
    problems.push(`El número de vanos debe estar entre ${L.minSpans} y ${L.maxSpans}.`);
  }
  if (spec.girderCount !== null && (spec.girderCount < 2 || spec.girderCount > 12)) {
    problems.push('El número de vigas principales debe estar entre 2 y 12.');
  }
  if (spec.lanes !== null && (spec.lanes < 1 || spec.lanes > 8)) {
    problems.push('El número de carriles debe estar entre 1 y 8.');
  }
  if (spec.disciplines.length === 0) problems.push('Selecciona al menos una disciplina.');
  return problems;
}
