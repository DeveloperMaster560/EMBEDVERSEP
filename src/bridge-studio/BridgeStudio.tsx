/**
 * EMBEDVERSE BRIDGE STUDIO
 *
 * El flujo, el visor y los controles los pone `ModelStudio`. Aquí vive solo lo
 * propio del dominio puente: el vocabulario, el intérprete del enunciado, el
 * endpoint del generador y qué cifras tiene sentido destacar.
 *
 * No sustituye a `src/bridge-designer`, que modela un puente conceptual para
 * visualizar una propuesta. Este genera el modelo paramétrico multidisciplinario
 * con estructura, tablero, barreras, drenaje, iluminación, señalización e
 * instrumentación, y detecta interferencias entre ellas.
 */

import { ModelStudio, type StudioDomainConfig } from '../model-viewer/ModelStudio';
import type { ModelGenerationResult } from '../model-viewer/contracts';
import {
  BRIDGE_DISCIPLINE_LABEL,
  toGeneratorSpec,
  validateSpecification,
  type BridgeSpecification,
} from './contracts';
import {
  describeSpecification,
  interpretBridgePrompt,
  isReadyToGenerate,
} from './prompt-interpreter';

const EXAMPLES = [
  'Puente de vigas de 90 m de longitud, 10 m de ancho de tablero, tablero a 7 m sobre el terreno, 3 vanos, 4 vigas principales y 2 carriles con aceras.',
  'Puente de losa de 24 m de longitud y 9 m de ancho, tablero a 5 m sobre el cauce, 2 carriles sin aceras.',
  'Puente atirantado de 240 m de longitud y 16 m de ancho de tablero, tablero a 22 m sobre el terreno, 3 vanos y 4 carriles.',
  // Obra real: nombrarla carga su ficha documentada en vez de interpretar el
  // texto. Las fuentes de cada dato aparecen en los supuestos.
  'Viaducto de la Novena, Bucaramanga.',
];

const bridgeDomain: StudioDomainConfig<BridgeSpecification> = {
  domain: 'bridge',
  eyebrow: 'EMBEDVERSE BRIDGE STUDIO',
  title: 'Puente multidisciplinario desde un enunciado',
  intro:
    'El enunciado se interpreta con reglas locales. Lo que no se pueda deducir se pregunta; no se rellena con valores inventados.',
  promptLabel: 'Describe el puente',
  promptPlaceholder: 'Puente de vigas de 90 m, 10 m de ancho, tablero a 7 m sobre el terreno…',
  examples: EXAMPLES,
  endpoint: '/api/bridge/generate',
  zoneTitle: 'Zonas',
  explodeLabel: 'Separar conjuntos',
  explodeMax: 20,
  emptyHint:
    'Describe el puente y pulsa «Generar modelo». El generador construye cimentación, pilas, estribos, apoyos, superestructura, tablero e instalaciones a partir de los parámetros interpretados.',
  disciplineLabel: BRIDGE_DISCIPLINE_LABEL,
  interpret: interpretBridgePrompt,
  describe: describeSpecification,
  questionsOf: (spec) => spec.questions,
  assumptionsOf: (spec) => spec.assumptions,
  validate: validateSpecification,
  ready: isReadyToGenerate,
  toGeneratorSpec,
  headlineStats: (result: ModelGenerationResult) => {
    const applied = result.applied;
    const stats = [
      { label: 'Tipología', value: String(applied.bridge_type_label ?? '—') },
      {
        label: 'Luz de vano',
        value: `${Number(applied.span_length_m ?? 0).toFixed(2)} m`,
      },
      {
        label: 'Calzada',
        value: `${Number(applied.carriageway_width_m ?? 0).toFixed(2)} m · ${applied.lanes ?? '—'} carriles`,
      },
    ];
    const mass = result.engineering?.totalMassKg ?? 0;
    if (mass > 0) {
      stats.push({
        label: 'Masa estructural',
        value: `${(mass / 1000).toLocaleString('es', { maximumFractionDigits: 0 })} t`,
      });
    }
    const towerHeight = Number(applied.tower_height_m ?? 0);
    if (towerHeight > 0) {
      stats.push({ label: 'Altura de torre', value: `${towerHeight.toFixed(2)} m` });
    }
    return stats;
  },
};

export interface BridgeStudioProps {
  projectId?: string;
  projectName?: string;
  onOpenEditor?: () => void;
}

export function BridgeStudio(props: BridgeStudioProps): React.JSX.Element {
  return <ModelStudio config={bridgeDomain} {...props} />;
}
