export type BridgeAiType = 'beam' | 'slab' | 'cable_stayed';
export type BridgeHeightMeaning =
  | 'deck_above_ground'
  | 'total_structure'
  | 'tower_height'
  | 'clearance'
  | 'end_elevation_difference'
  | 'unknown';
export type SupportDistribution = 'along_length' | 'paired_across_width' | 'unknown';
export type BridgeComponentType =
  | 'deck'
  | 'support'
  | 'abutment'
  | 'main_girder'
  | 'cross_beam'
  | 'guardrail'
  | 'tower'
  | 'stay_cable'
  | 'foundation'
  | 'decoration';

export interface BridgeSpecification {
  schemaVersion: 1;
  structureType: BridgeAiType;
  bridgeName: string;
  units: 'm';
  overallDimensions: {
    lengthM: number | null;
    widthM: number | null;
    heightM: number | null;
    heightMeaning: BridgeHeightMeaning;
    heightReference: string | null;
  };
  stayCableCount?: number | null;
  cableStayed?: {
    towerHeightM: number | null;
    towerSpacingM: number | null;
    towerSectionWidthM: number | null;
    towerSectionDepthM: number | null;
    stayCableDiameterM: number | null;
    mainGirderCount: number | null;
    mainGirderHeightM: number | null;
    mainGirderWidthM: number | null;
    crossBeamSpacingM: number | null;
    crossBeamWidthM: number | null;
    crossBeamHeightM: number | null;
    foundationLengthM: number | null;
    foundationWidthM: number | null;
    foundationDepthM: number | null;
    guardrailHeightM: number | null;
  };
  deck: { thicknessM: number | null };
  supports: {
    type: 'pier' | 'column' | 'unknown';
    orientation: 'vertical' | 'unknown';
    distribution: SupportDistribution;
    quantity: number | null;
    widthM: number | null;
    depthM: number | null;
    material: 'concrete' | 'steel' | 'unknown';
  };
  components: { id: string; type: BridgeComponentType; included: boolean }[];
  assumptions: string[];
  unresolvedQuestions: string[];
  warnings: string[];
  generationStatus: 'needs_clarification' | 'ready_for_approval';
  conceptualModel: true;
}

export class BridgeSpecificationError extends Error {
  readonly code: 'INVALID_SPECIFICATION' | 'UNSUPPORTED_BRIDGE_TYPE';

  constructor(message: string, code: 'INVALID_SPECIFICATION' | 'UNSUPPORTED_BRIDGE_TYPE' = 'INVALID_SPECIFICATION') {
    super(message);
    this.name = 'BridgeSpecificationError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

const componentTypes = new Set<BridgeComponentType>([
  'deck', 'support', 'abutment', 'main_girder', 'cross_beam', 'guardrail',
  'tower', 'stay_cable', 'foundation', 'decoration',
]);

export function parseBridgeSpecification(value: unknown): BridgeSpecification {
  if (!isRecord(value) || !isRecord(value.overallDimensions) || !isRecord(value.deck) || !isRecord(value.supports)) {
    throw new BridgeSpecificationError('La especificación está incompleta o tiene un formato inválido.');
  }
  if (value.structureType !== 'beam' && value.structureType !== 'slab' && value.structureType !== 'cable_stayed') {
    throw new BridgeSpecificationError(
      'Esta versión genera puentes de vigas, de losa y atirantados; la tipología solicitada todavía no está disponible.',
      'UNSUPPORTED_BRIDGE_TYPE',
    );
  }

  const dimensions = value.overallDimensions;
  const supports = value.supports;
  const lengthM = dimensions.lengthM;
  const widthM = dimensions.widthM;
  const heightM = dimensions.heightM;
  const thicknessM = value.deck.thicknessM;
  const cableStayed = value.cableStayed;
  const quantity = supports.quantity;
  const supportWidthM = supports.widthM;
  const supportDepthM = supports.depthM;
  const validNumber = (number: unknown, min: number) => isNumberOrNull(number) && (number === null || number >= min);
  if (
    value.schemaVersion !== 1
    || value.units !== 'm'
    || typeof value.bridgeName !== 'string'
    || !value.bridgeName.trim()
    || !validNumber(lengthM, 0)
    || (typeof lengthM === 'number' && (lengthM <= 0 || lengthM > 10_000))
    || !validNumber(widthM, 0)
    || (typeof widthM === 'number' && (widthM <= 0 || widthM > 1_000))
    || !validNumber(heightM, 0)
    || (typeof heightM === 'number' && (heightM <= 0 || heightM > 1_000))
    || !(value.stayCableCount === undefined
      || value.stayCableCount === null
      || (typeof value.stayCableCount === 'number'
        && Number.isInteger(value.stayCableCount)
        && value.stayCableCount >= 8
        && value.stayCableCount <= 400
        && value.stayCableCount % 8 === 0))
    || !(cableStayed === undefined || (isRecord(cableStayed)
      && Object.entries(cableStayed).every(([key, number]) => (
        key === 'mainGirderCount'
          ? number === null || (typeof number === 'number' && Number.isInteger(number) && number >= 2 && number <= 12)
          : isNumberOrNull(number) && (number === null || (number > 0 && number <= 1_000))
      ))
      && Object.keys(cableStayed).length === 15
      && [
        'towerHeightM', 'towerSpacingM', 'towerSectionWidthM', 'towerSectionDepthM',
        'stayCableDiameterM', 'mainGirderCount', 'mainGirderHeightM', 'mainGirderWidthM',
        'crossBeamSpacingM', 'crossBeamWidthM', 'crossBeamHeightM',
        'foundationLengthM', 'foundationWidthM', 'foundationDepthM', 'guardrailHeightM',
      ].every((key) => key in cableStayed)))
    || !['deck_above_ground', 'total_structure', 'tower_height', 'clearance', 'end_elevation_difference', 'unknown'].includes(String(dimensions.heightMeaning))
    || !(dimensions.heightReference === null || typeof dimensions.heightReference === 'string')
    || !validNumber(thicknessM, 0)
    || (typeof thicknessM === 'number' && (thicknessM <= 0 || thicknessM > 100))
    || !['pier', 'column', 'unknown'].includes(String(supports.type))
    || !['vertical', 'unknown'].includes(String(supports.orientation))
    || !['along_length', 'paired_across_width', 'unknown'].includes(String(supports.distribution))
    || !(quantity === null || (typeof quantity === 'number' && Number.isInteger(quantity) && quantity >= 0))
    || (typeof quantity === 'number' && quantity > 100)
    || !validNumber(supportWidthM, 0)
    || (typeof supportWidthM === 'number' && (supportWidthM <= 0 || supportWidthM > 100))
    || !validNumber(supportDepthM, 0)
    || (typeof supportDepthM === 'number' && (supportDepthM <= 0 || supportDepthM > 100))
    || !['concrete', 'steel', 'unknown'].includes(String(supports.material))
    || !Array.isArray(value.components)
    || !value.components.every((item) => isRecord(item)
      && typeof item.id === 'string'
      && typeof item.included === 'boolean'
      && componentTypes.has(item.type as BridgeComponentType))
    || !isStringArray(value.assumptions)
    || !isStringArray(value.unresolvedQuestions)
    || !isStringArray(value.warnings)
    || !['needs_clarification', 'ready_for_approval'].includes(String(value.generationStatus))
    || value.conceptualModel !== true
  ) {
    throw new BridgeSpecificationError('La especificación es inválida. No se generó geometría.');
  }

  const specification = value as unknown as BridgeSpecification;
  const questions = [...specification.unresolvedQuestions];
  if (specification.overallDimensions.lengthM === null) questions.push('¿Cuál es la longitud del puente?');
  if (specification.overallDimensions.widthM === null) questions.push('¿Cuál es el ancho del puente?');
  if (specification.overallDimensions.heightM === null || specification.overallDimensions.heightMeaning !== 'deck_above_ground') {
    questions.push('¿Qué altura debe tener el tablero sobre el terreno?');
  }
  if (specification.overallDimensions.heightMeaning === 'deck_above_ground'
    && !specification.overallDimensions.heightReference?.trim()) {
    questions.push('¿Respecto a qué nivel de terreno se mide la altura del tablero?');
  }
  if (specification.supports.quantity === null) questions.push('¿Cuántos apoyos necesitas?');
  if (specification.supports.quantity !== null && specification.supports.quantity > 0 && specification.supports.distribution === 'unknown') {
    questions.push('¿Cómo se distribuyen los apoyos: en una fila a lo largo del puente o en pares a ambos lados?');
  }
  if (specification.supports.quantity !== null
    && specification.supports.distribution === 'paired_across_width'
    && specification.supports.quantity % 2 !== 0) {
    questions.push('La distribución en pares requiere una cantidad par; corrige la cantidad de apoyos.');
  }
  const uniqueQuestions = [...new Set(questions)];
  const unsupportedComponents = specification.components
    .filter(({ included, type }) => included && type === 'decoration')
    .map(() => 'elementos decorativos');
  const assumptions = specification.assumptions.filter((assumption) => (
    !assumption.startsWith('Se usará un espesor conceptual heurístico')
    && !assumption.startsWith('Las secciones de apoyos')
    && !assumption.startsWith('La posición de los apoyos')
    && !assumption.startsWith('El tipo de apoyo se representa')
    && !assumption.startsWith('Se representa la orientación de los apoyos')
    && !assumption.startsWith('El material no especificado')
    && !assumption.startsWith('Las dimensiones de las vigas')
  ));
  if (specification.deck.thicknessM === null) {
    assumptions.push('Se usará un espesor conceptual heurístico para el tablero; no es una dimensión indicada por el usuario.');
  }
  if (specification.supports.quantity && (specification.supports.widthM === null || specification.supports.depthM === null)) {
    assumptions.push('Las secciones de apoyos sin dimensiones explícitas se completarán con proporciones geométricas heurísticas.');
  }
  if (specification.supports.quantity && specification.supports.distribution !== 'unknown') {
    assumptions.push('La posición de los apoyos se distribuye uniformemente según la distribución elegida; no se indicó una posición exacta.');
  }
  if (specification.supports.quantity && specification.supports.type === 'unknown') {
    assumptions.push('El tipo de apoyo se representa como un prisma conceptual porque no se especificó su forma.');
  }
  if (specification.supports.quantity && specification.supports.orientation === 'unknown') {
    assumptions.push('Se representa la orientación de los apoyos como vertical porque no se especificó otra.');
  }
  if (specification.supports.quantity && specification.supports.material === 'unknown') {
    assumptions.push('El material no especificado se representa visualmente como concreto; esto no constituye una especificación de material.');
  }
  if (specification.structureType === 'beam') {
    assumptions.push('Las dimensiones de las vigas y elementos transversales se crearán con reglas geométricas proporcionales, sin cálculo estructural.');
  }
  if (specification.structureType === 'cable_stayed') {
    assumptions.push('La altura y la disposición de torres, cables, apoyos y cimentaciones son proporciones geométricas conceptuales, no dimensiones extraídas de planos ni verificadas estructuralmente.');
  }
  const warnings = specification.warnings.filter((warning) => !warning.startsWith('Componentes no disponibles en este MVP:'));
  const conceptualWarning = 'MODELO CONCEPTUAL — NO VALIDADO PARA CONSTRUCCIÓN; no incluye cálculo estructural ni revisión normativa.';
  if (!warnings.includes(conceptualWarning)) warnings.push(conceptualWarning);
  if (unsupportedComponents.length) {
    warnings.push(`Componentes no disponibles en este MVP: ${[...new Set(unsupportedComponents)].join(', ')}. Desmárcalos para generar.`);
  }
  return {
    ...specification,
    assumptions,
    unresolvedQuestions: uniqueQuestions,
    generationStatus: uniqueQuestions.length ? 'needs_clarification' : 'ready_for_approval',
    warnings,
  };
}

/**
 * Por qué todavía no se puede generar, en lenguaje llano.
 *
 * Es la ÚNICA definición de las condiciones: `canGenerateBridge` se deriva de
 * ella. Antes la comprobación era una conjunción booleana y el botón quedaba
 * inerte sin explicar qué faltaba, que es la peor forma de pedir un dato.
 */
export function describeGenerationBlockers(specification: BridgeSpecification): string[] {
  const blockers: string[] = [];
  const { overallDimensions: dims, supports } = specification;
  const enabledComponents = new Set(
    specification.components.filter(({ included }) => included).map(({ type }) => type),
  );

  for (const question of specification.unresolvedQuestions) {
    blockers.push(question);
  }

  if (dims.lengthM === null) blockers.push('Falta la longitud del puente.');
  else if (dims.lengthM > 10_000) blockers.push('La longitud supera los 10.000 m que admite este generador.');

  if (dims.widthM === null) blockers.push('Falta el ancho del puente.');
  else if (dims.widthM > 1_000) blockers.push('El ancho supera los 1.000 m que admite este generador.');

  if (dims.heightM === null) blockers.push('Falta la altura del puente.');
  else if (dims.heightM > 1_000) blockers.push('La altura supera los 1.000 m que admite este generador.');

  if (dims.heightMeaning !== 'deck_above_ground') {
    blockers.push('Indica en «Referencia de altura» que la altura es la del tablero sobre el terreno; el generador solo sabe colocar el tablero con esa referencia.');
  }
  if (!dims.heightReference?.trim()) {
    blockers.push('Escribe en «Referencia descriptiva» respecto a qué se mide la altura.');
  }

  if (supports.quantity === null) {
    blockers.push('Indica cuántos apoyos tiene el puente en «Apoyos totales»; escribe 0 si no lleva ninguno.');
  } else if (supports.quantity > 100) {
    blockers.push('El número de apoyos supera los 100 que admite este generador.');
  } else if (supports.quantity > 0) {
    if (supports.distribution === 'unknown') {
      blockers.push('Elige en «Distribución de apoyos» si van en una fila a lo largo del puente o en pares a ambos lados.');
    } else if (supports.distribution === 'paired_across_width' && supports.quantity % 2 !== 0) {
      blockers.push(`Con apoyos en pares a ambos lados el total debe ser par; ahora hay ${supports.quantity}.`);
    }
  }

  if (specification.structureType === 'cable_stayed') {
    if (!enabledComponents.has('tower')) blockers.push('Un puente atirantado necesita torres: márcalas en «Componentes incluidos».');
    if (!enabledComponents.has('stay_cable')) blockers.push('Un puente atirantado necesita tirantes: márcalos en «Componentes incluidos».');
  }

  if (specification.components.some(({ included, type }) => included && type === 'decoration')) {
    blockers.push('La decoración no está disponible en este generador: desmárcala.');
  }

  return blockers;
}

export function canGenerateBridge(specification: BridgeSpecification): boolean {
  return describeGenerationBlockers(specification).length === 0;
}
