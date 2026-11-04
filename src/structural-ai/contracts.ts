export type StructureFamily = 'bridge' | 'cathedral' | (string & {});
export type StructuralUnit = 'm' | 'cm' | 'mm';

export interface StructuralReference {
  id: string;
  name: string;
  mediaType: string;
  attribution?: string;
  license?: string;
}

export interface StructuralParameter {
  id: string;
  value: number | string | boolean;
  unit?: StructuralUnit;
  source: 'user' | 'document';
  referenceId?: string;
}

export interface StructuralGenerationRequest {
  schemaVersion: 1;
  family: StructureFamily;
  description: string;
  unit: StructuralUnit;
  parameters: StructuralParameter[];
  constraints: string[];
  references: StructuralReference[];
}

export interface StructuralParameterProposal extends StructuralParameter {
  confidence: 'specified' | 'inferred' | 'unknown';
  explanation?: string;
}

export interface StructuralSourceCitation {
  referenceId: string;
  page?: string;
  section?: string;
  supports: string;
}

export interface StructuralGenerationProposal {
  schemaVersion: 1;
  requestId: string;
  family: StructureFamily;
  summary: string;
  parameters: StructuralParameterProposal[];
  assumptions: string[];
  questions: string[];
  citations: StructuralSourceCitation[];
  limitations: string[];
  intendedUse: 'conceptual-only';
}

export type StructuralGenerationProvider = (
  request: StructuralGenerationRequest,
) => Promise<StructuralGenerationProposal>;

export function createStructuralGenerationRequest(input: {
  family: StructureFamily;
  description: string;
  unit: StructuralUnit;
  parameters?: StructuralParameter[];
  constraints?: string[];
  references?: StructuralReference[];
}): StructuralGenerationRequest {
  const description = input.description.trim();
  if (!description) throw new Error('Describe qué estructura quieres crear.');
  if (description.length > 8000) throw new Error('La descripción no puede superar 8000 caracteres.');

  const referenceIds = new Set((input.references ?? []).map(({ id }) => id));
  for (const parameter of input.parameters ?? []) {
    if (parameter.source === 'document' && (!parameter.referenceId || !referenceIds.has(parameter.referenceId))) {
      throw new Error(`El parámetro “${parameter.id}” necesita una referencia documental válida.`);
    }
    if (typeof parameter.value === 'number' && !Number.isFinite(parameter.value)) {
      throw new Error(`El parámetro “${parameter.id}” debe tener un valor numérico finito.`);
    }
  }

  return {
    schemaVersion: 1,
    family: input.family,
    description,
    unit: input.unit,
    parameters: structuredClone(input.parameters ?? []),
    constraints: (input.constraints ?? []).map((constraint) => constraint.trim()).filter(Boolean),
    references: structuredClone(input.references ?? []),
  };
}
