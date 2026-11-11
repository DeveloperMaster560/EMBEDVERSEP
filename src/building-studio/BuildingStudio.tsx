/**
 * EMBEDVERSE BUILDING STUDIO
 *
 * El flujo, el visor y los controles los pone `ModelStudio`. Aquí vive solo lo
 * propio del dominio edificio: el vocabulario, el intérprete del enunciado, el
 * endpoint del generador y qué cifras tiene sentido destacar.
 */

import { ModelStudio, type StudioDomainConfig } from '../model-viewer/ModelStudio';
import {
  MASS_BASIS_SHORT, MODELLED_MASS_LABEL, formatModelledMass,
} from '../model-viewer/mass-report';
import type { ModelGenerationResult } from '../model-viewer/contracts';
import {
  DISCIPLINE_LABEL,
  toGeneratorSpec,
  validateSpecification,
  type BuildingSpecification,
} from './contracts';
import {
  describeSpecification,
  interpretBuildingPrompt,
  isReadyToGenerate,
} from './prompt-interpreter';

const EXAMPLES = [
  'Edificio institucional de 3 niveles, longitud 24 m, ancho 18 m, altura libre 3.20 m y altura entre niveles 3.60 m.',
  'Bloque de oficinas de 5 pisos de 36 x 24 metros, altura libre 3.00 m, con 2 salas de juntas.',
  'Edificio educativo de 4 niveles de 40 x 20 m, altura libre 3.10 m, con 6 aulas y 2 laboratorios.',
];

const buildingDomain: StudioDomainConfig<BuildingSpecification> = {
  domain: 'building',
  eyebrow: 'EMBEDVERSE BUILDING STUDIO',
  title: 'Modelo multidisciplinario desde un enunciado',
  intro:
    'El enunciado se interpreta con reglas locales. Lo que no se pueda deducir se pregunta; no se rellena con valores inventados.',
  promptLabel: 'Describe el edificio',
  promptPlaceholder: 'Edificio institucional de 3 niveles, 24 x 18 m, altura libre 3.20 m…',
  examples: EXAMPLES,
  endpoint: '/api/building/generate',
  zoneTitle: 'Niveles',
  explodeLabel: 'Separar niveles',
  explodeMax: 12,
  emptyHint:
    'Describe el edificio y pulsa «Generar modelo». El generador construye estructura, arquitectura e instalaciones a partir de los parámetros interpretados.',
  disciplineLabel: DISCIPLINE_LABEL,
  interpret: interpretBuildingPrompt,
  describe: describeSpecification,
  questionsOf: (spec) => spec.questions,
  assumptionsOf: (spec) => spec.assumptions,
  validate: validateSpecification,
  ready: isReadyToGenerate,
  toGeneratorSpec,
  headlineStats: (result: ModelGenerationResult) => {
    const area = Number(result.applied.total_area_m2 ?? 0);
    const mass = result.engineering?.totalMassKg ?? 0;
    const stats = [
      { label: 'Recintos', value: String(result.counts.spaces) },
      { label: 'Área construida', value: `${area.toLocaleString('es')} m²` },
    ];
    if (mass > 0) {
      stats.push({
        label: MODELLED_MASS_LABEL,
        value: `${formatModelledMass(mass, 0)} · ${MASS_BASIS_SHORT}`,
      });
    }
    return stats;
  },
};

export interface BuildingStudioProps {
  projectId?: string;
  projectName?: string;
  onOpenEditor?: () => void;
}

export function BuildingStudio(props: BuildingStudioProps): React.JSX.Element {
  return <ModelStudio config={buildingDomain} {...props} />;
}
