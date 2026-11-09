/**
 * Contrato del resultado del generador paramétrico, común a los dos dominios.
 *
 * El generador en Python devuelve la misma estructura para un edificio y para
 * un puente: cambia `applied` (los parámetros adoptados, propios de cada
 * dominio) y el significado de `levels`, que en un puente son zonas
 * constructivas. Todo lo demás —componentes, validación, pendientes— es igual.
 *
 * Criterio de honestidad: un valor nunca significa "cero" ni "por defecto
 * silencioso". Lo que el generador asumió aparece en `adjustments`, lo que no
 * pudo determinar se cuenta en `pending`, y `professionalReview` es siempre
 * `not_reviewed`.
 */

export interface GeneratedComponentSummary {
  component_id: string;
  discipline: string;
  type: string;
  name: string;
  level_id: string | null;
  space_id: string | null;
  material: string | null;
  pending_count: number;
}

export interface GeneratedZone {
  level_id: string;
  name: string;
  /**
   * Número de referencia de la zona. En un edificio es la cota del nivel; en un
   * puente puede ser una cota o una abscisa longitudinal, según la zona. Para
   * mostrarlo úsese `caption`, que dice con qué unidad y significado leerlo.
   */
  elevation: number;
  caption?: string;
}

export interface GeneratedSpace {
  space_id: string;
  code: string;
  name: string;
  use: string;
  level_id: string;
  area_m2: number;
}

/**
 * Propiedades que el generador dedujo de la geometria ya construida.
 *
 * Solo recogen lo que se sigue de la forma y de una densidad declarada:
 * seccion y peso propio. No hay esfuerzos, flechas, armadura ni combinaciones
 * de carga; eso exige f'c, cargas y factores de norma que el generador no
 * conoce y que siguen enumerados en `stillPending`.
 */
export interface EngineeringReport {
  embedlibAvailable: boolean;
  embedlibVersion: string | null;
  reasonUnavailable: string | null;
  componentsExamined: number;
  sectionPropertiesAdded: number;
  selfWeightAdded: number;
  skippedNoSection: number;
  skippedNoVolume: number;
  uncoveredTypes: Record<string, number>;
  totalMassKg: number;
  totalWeightKN: number;
  stillPending: string[];
}

export interface ModelGenerationResult {
  schemaVersion: 1;
  projectId: string;
  domain: 'building' | 'bridge';
  /** glTF binario en base64. El visor lo carga sin tocar disco. */
  glbBase64: string;
  /** Parámetros realmente adoptados. Las claves dependen del dominio. */
  applied: Record<string, unknown>;
  adjustments: string[];
  counts: {
    components: number;
    connections: number;
    spaces: number;
    solids: number;
    operations: number;
    byDiscipline: Record<string, number>;
  };
  levels: GeneratedZone[];
  spaces: GeneratedSpace[];
  components: GeneratedComponentSummary[];
  validation: {
    consistencyErrors: number;
    consistencyWarnings: number;
    clashCount: number;
    clashesBySeverity: Record<string, number>;
    actionableClashes: number;
  };
  pending: {
    nullParameters: number;
    declarations: number;
  };
  /** Ausente cuando el generador es anterior a esta funcion. */
  engineering: EngineeringReport | null;
  /** Siempre 'not_reviewed'. Ningún modelo generado está revisado. */
  professionalReview: 'not_reviewed';
  generationMs: number;
}

export interface ModelGenerationError {
  error: string;
  detail: string;
  /** True cuando la solicitud es imposible, no cuando falló el proceso. */
  specRejected: boolean;
}

export function isGenerationError(
  value: ModelGenerationResult | ModelGenerationError,
): value is ModelGenerationError {
  return (value as ModelGenerationError).error !== undefined;
}

/** Adapta la respuesta del generador (snake_case) al contrato del visor. */
export function normalizeResult(
  payload: Record<string, unknown>,
  fallbackDomain: 'building' | 'bridge',
): ModelGenerationResult {
  const counts = (payload.counts as Record<string, unknown>) ?? {};
  const validation = (payload.validation as Record<string, unknown>) ?? {};
  const pending = (payload.pending as Record<string, unknown>) ?? {};
  const domain = payload.domain === 'bridge' || payload.domain === 'building'
    ? payload.domain
    : fallbackDomain;
  return {
    schemaVersion: 1,
    projectId: String(payload.project_id ?? 'EMBEDVERSE'),
    domain,
    glbBase64: String(payload.glb_base64 ?? ''),
    applied: (payload.applied as Record<string, unknown>) ?? {},
    adjustments: (payload.adjustments as string[]) ?? [],
    counts: {
      components: Number(counts.components ?? 0),
      connections: Number(counts.connections ?? 0),
      spaces: Number(counts.spaces ?? 0),
      solids: Number(counts.solids ?? 0),
      operations: Number(counts.operations ?? 0),
      byDiscipline: (counts.by_discipline as Record<string, number>) ?? {},
    },
    levels: (payload.levels as GeneratedZone[]) ?? [],
    spaces: (payload.spaces as GeneratedSpace[]) ?? [],
    components: (payload.components as GeneratedComponentSummary[]) ?? [],
    validation: {
      consistencyErrors: Number(validation.consistency_errors ?? 0),
      consistencyWarnings: Number(validation.consistency_warnings ?? 0),
      clashCount: Number(validation.clash_count ?? 0),
      clashesBySeverity: (validation.clashes_by_severity as Record<string, number>) ?? {},
      actionableClashes: Number(validation.actionable_clashes ?? 0),
    },
    pending: {
      nullParameters: Number(pending.null_parameters ?? 0),
      declarations: Number(pending.declarations ?? 0),
    },
    engineering: normalizeEngineering(payload.engineering),
    professionalReview: 'not_reviewed',
    generationMs: Number(payload.generation_ms ?? 0),
  };
}

function normalizeEngineering(value: unknown): EngineeringReport | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  return {
    embedlibAvailable: r.embedlib_available === true,
    embedlibVersion: typeof r.embedlib_version === 'string' ? r.embedlib_version : null,
    reasonUnavailable: typeof r.reason_unavailable === 'string' ? r.reason_unavailable : null,
    componentsExamined: Number(r.components_examined ?? 0),
    sectionPropertiesAdded: Number(r.section_properties_added ?? 0),
    selfWeightAdded: Number(r.self_weight_added ?? 0),
    skippedNoSection: Number(r.skipped_no_section ?? 0),
    skippedNoVolume: Number(r.skipped_no_volume ?? 0),
    uncoveredTypes: (r.uncovered_types as Record<string, number>) ?? {},
    totalMassKg: Number(r.total_mass_kg ?? 0),
    totalWeightKN: Number(r.total_weight_kN ?? 0),
    stillPending: Array.isArray(r.still_pending) ? (r.still_pending as string[]) : [],
  };
}
