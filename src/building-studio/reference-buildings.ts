/**
 * Edificios reales documentados.
 *
 * Mismas reglas que `src/bridge-studio/reference-bridges.ts`:
 *
 *  1. Cada dato lleva su fuente en `sources`. Ninguno se adopta «porque parece
 *     razonable».
 *  2. Lo que las fuentes no dicen queda en `null`. El Studio lo pregunta; nunca
 *     se rellena por analogía con un edificio típico.
 *  3. Se reproduce la geometría PUBLICADA, no un levantamiento.
 *  4. Discrepancias y límites van en `caveats` y se muestran antes de generar.
 *
 * Diferencia con los puentes: aquí faltan datos que el usuario sí puede medir
 * en sitio (las alturas). Por eso las alturas escritas en el mismo enunciado
 * se aceptan, y quedan registradas como declaradas por el usuario, no como
 * dato de la ficha.
 */

import type { BuildingSpecification } from './contracts';

export interface ReferenceBuilding {
  id: string;
  name: string;
  /** Formas de nombrarlo, en minúsculas y sin tildes. Se comparan como palabras completas. */
  aliases: string[];
  sources: string[];
  caveats: string[];
  /** Alturas en `null`: ninguna fuente pública las da. */
  specification: BuildingSpecification;
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

const UTS_EVALUACION =
  'Unidades Tecnológicas de Santander, «Evaluación técnica de la infraestructura física», uts.edu.co (2019)';
const OSM_BLOQUE_A = 'OpenStreetMap, vía 1496340513 (© colaboradores de OpenStreetMap, ODbL)';

export const REFERENCE_BUILDINGS: ReferenceBuilding[] = [
  {
    id: 'uts-bloque-a-bucaramanga',
    name: 'Unidades Tecnológicas de Santander (UTS), Bloque A, sede principal Bucaramanga',
    aliases: [
      'bloque a de las uts',
      'bloque a uts',
      'uts bloque a',
      'edificio a de las uts',
      'edificio a uts',
      'unidades tecnologicas de santander',
      'unidades tecnologicas',
      'universitaria tecnologica de santander',
      'universitaria tecnologicas de santander',
      'universitarias tecnologicas de santander',
      'uts',
    ],
    sources: [
      `Cuatro pisos sobre rasante más un sótano. Áreas construidas: sótano 1.674,79 m²; piso 1 1.872,33 m²; pisos 2 y 3 1.898,91 m²; piso 4 1.741,34 m²; total 9.086,28 m². Fuente: ${UTS_EVALUACION}, pág. 2.`,
      `Planta de 102,9 × 19,6 m: rectángulo mínimo que contiene el contorno del edificio en ${OSM_BLOQUE_A}, medido en esta sesión. El contorno encierra 1.892 m², a un 0,4 % del piso tipo oficial (1.898,91 m²).`,
      `Uso educativo: 39 aulas de 50 m², 26 laboratorios, 1 auditorio de 280 m² y 35 áreas de coordinación y oficinas, según ${UTS_EVALUACION}, págs. 4 y 12.`,
      'Dirección del campus: Calle de los Estudiantes 9-82, Ciudadela Real de Minas. Centroide del contorno: 7,105379 N / −73,123246 W (WGS84, calculado sobre la vía de OpenStreetMap).',
    ],
    caveats: [
      'Que ese contorno de OpenStreetMap sea el Bloque A es una IDENTIFICACIÓN POR ÁREA, no un dato publicado: el polígono no tiene nombre. Confírmalo sobre el terreno.',
      'OpenStreetMap etiqueta ese edificio con 10 niveles; el documento oficial de las UTS da sótano + 4 pisos. Se adopta el documento oficial.',
      'El contorno real no es un rectángulo perfecto: el rectángulo modelado tiene 2.017 m² por planta, un 6 % más que los 1.892 m² del contorno.',
      'El SÓTANO no se modela (el generador no cubre sótanos), y el piso 4 es más pequeño (1.741,34 m²) que el modelado: todas las plantas salen iguales.',
      'Ninguna fuente pública da la altura libre ni la altura entre pisos. Si no las escribes en el enunciado (por ejemplo «altura libre 2.80 m, entre niveles 3.40 m»), el modelo no se genera.',
      'El reparto de aulas, laboratorios y oficinas por piso lo hace el generador por reglas; no es la distribución real del edificio. Tampoco se modelan la rampa ni los dos ascensores que tiene el Bloque A.',
      'Ningún dato procede de planos de proyecto ni de un levantamiento.',
    ],
    specification: {
      schemaVersion: 1,
      projectName: 'UTS — Bloque A (sede principal, Bucaramanga)',
      buildingUse: 'educativo',
      units: 'm',
      levels: 4,
      lengthXM: 102.9,
      widthYM: 19.6,
      clearHeightM: null,
      floorToFloorM: null,
      corridorWidthM: null,
      coreSizeM: null,
      roomsByBand: {},
      disciplines: [
        'architecture', 'structure', 'electrical', 'telecommunications',
        'hydrosanitary', 'hvac', 'security',
      ],
      assumptions: [],
      questions: [],
      unrecognized: [],
    },
  },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Busca un edificio de referencia nombrado en el enunciado (palabras completas). */
export function matchReferenceBuilding(prompt: string): ReferenceBuilding | null {
  const text = fold(prompt);
  let best: ReferenceBuilding | null = null;
  let bestLength = 0;
  for (const building of REFERENCE_BUILDINGS) {
    for (const alias of building.aliases) {
      // Palabra completa: «uts» no debe encajar dentro de otra palabra.
      const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(alias)}(?:$|[^a-z0-9])`);
      if (re.test(text) && alias.length > bestLength) {
        best = building;
        bestLength = alias.length;
      }
    }
  }
  return best;
}

/**
 * Especificación de la ficha con su trazabilidad. Las alturas que el usuario
 * haya escrito en el enunciado completan lo que la ficha deja en `null`, y
 * se declaran como suyas.
 */
export function specificationForBuilding(
  building: ReferenceBuilding,
  declared: { clearHeightM: number | null; floorToFloorM: number | null },
): BuildingSpecification {
  const base = building.specification;
  const clearHeightM = base.clearHeightM ?? declared.clearHeightM;
  const floorToFloorM = base.floorToFloorM ?? declared.floorToFloorM;

  const assumptions = [
    `Edificio de referencia documentado: ${building.name}. Las dimensiones no se han interpretado del enunciado, se han cargado de su ficha.`,
    ...building.sources,
  ];
  if (base.clearHeightM === null && declared.clearHeightM !== null) {
    assumptions.push(`Altura libre ${declared.clearHeightM.toFixed(2)} m: DECLARADA POR EL USUARIO en el enunciado, no procede de ninguna fuente publicada.`);
  }
  if (base.floorToFloorM === null && declared.floorToFloorM !== null) {
    assumptions.push(`Altura entre niveles ${declared.floorToFloorM.toFixed(2)} m: DECLARADA POR EL USUARIO en el enunciado, no procede de ninguna fuente publicada.`);
  }

  const questions = [...building.caveats];
  if (clearHeightM === null && floorToFloorM === null) {
    questions.unshift('¿Qué altura libre y qué altura entre niveles tiene el edificio? Mídelas en sitio y escríbelas junto al nombre, por ejemplo: «Bloque A UTS, altura libre 2.80 m, entre niveles 3.40 m».');
  }

  return {
    ...base,
    clearHeightM,
    floorToFloorM,
    roomsByBand: { ...base.roomsByBand },
    disciplines: [...base.disciplines],
    assumptions,
    questions,
    unrecognized: [],
  };
}
