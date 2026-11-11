/**
 * Intérprete local de solicitudes de puente en español.
 *
 * Es un intérprete DETERMINISTA de reglas y patrones de texto, igual que el de
 * edificación: no es un modelo entrenado, no aprende y no envía nada a ningún
 * servicio externo. Reconoce un vocabulario acotado y declara explícitamente lo
 * que no entendió, en vez de rellenarlo con un valor plausible.
 */

import {
  ALL_BRIDGE_DISCIPLINES,
  BRIDGE_TYPE_LABEL,
  type BridgeDisciplineKey,
  type BridgeSpecification,
  type BridgeType,
} from './contracts';
import { matchReferenceBridge, specificationFor } from './reference-bridges';

const NUMBER_WORDS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // marcas diacriticas combinantes
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convierte un valor con unidad a metros. Solo unidades métricas. */
function toMeters(value: string, unit: string): number {
  const n = Number.parseFloat(value.replace(',', '.'));
  if (!Number.isFinite(n)) return Number.NaN;
  if (/^mm|milimetros?$/.test(unit)) return n / 1000;
  if (/^cm|centimetros?$/.test(unit)) return n / 100;
  return n;
}

const UNIT = '(mm|cm|m|metros?|centimetros?|milimetros?)';

/**
 * Busca "<número> <unidad> de <etiqueta>" o "<etiqueta> … <número> <unidad>".
 *
 * La forma pospuesta («90 m de longitud») se prueba PRIMERO porque es
 * inequívoca: el número está pegado a su etiqueta. La antepuesta («longitud
 * 90 m») admite texto en medio, así que en «90 m de longitud, 10 m de ancho»
 * capturaría el 10 si se probara antes.
 */
function measurement(text: string, labels: string): number | null {
  const backward = new RegExp(
    `(\\d+(?:[.,]\\d+)?)\\s*${UNIT}\\s+(?:de\\s+)?(?:${labels})\\b`,
  );
  const forward = new RegExp(
    `(?:${labels})[^.;\\n]{0,30}?(\\d+(?:[.,]\\d+)?)\\s*${UNIT}\\b`,
  );
  for (const re of [backward, forward]) {
    const m = re.exec(text);
    if (m) {
      const value = toMeters(m[1], m[2]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

/**
 * Busca una cantidad entera asociada a una etiqueta, en dígito o palabra.
 *
 * Solo acepta la forma «N etiqueta» («4 vanos», «cuatro vigas»). La forma
 * inversa se descarta a propósito: en un enunciado de puente, «vigas de 1.20 m
 * de canto» daría 1 viga, y es mejor preguntar que contar mal.
 */
function count(text: string, labels: string): number | null {
  const digits = new RegExp(`(\\d{1,3})\\s*(?:${labels})\\b`).exec(text);
  if (digits) {
    const n = Number.parseInt(digits[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const words = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\s+(?:${labels})\\b`).exec(text);
  if (words) return NUMBER_WORDS[words[1]];
  return null;
}

/** Primera medida que encaje, probando las etiquetas más específicas antes. */
function firstMeasurement(text: string, labelSets: string[]): number | null {
  for (const labels of labelSets) {
    const value = measurement(text, labels);
    if (value !== null) return value;
  }
  return null;
}

const DISCIPLINE_PATTERNS: { re: RegExp; key: BridgeDisciplineKey }[] = [
  { re: /\b(?:estructural|estructura|vigas?|pilas?|estribos?|cimentacion)\b/, key: 'structure' },
  { re: /\b(?:tablero|calzada|carpeta|pavimento|acera|demarcacion)\b/, key: 'deck' },
  { re: /\b(?:barreras?|defensas?|barandas?|new jersey|pretil(?:es)?)\b/, key: 'barriers' },
  { re: /\b(?:drenaje|sumideros?|bajantes?|desagues?|evacuacion de aguas)\b/, key: 'drainage' },
  { re: /\b(?:iluminacion|luminarias?|alumbrado|postes? de luz)\b/, key: 'lighting' },
  { re: /\b(?:senalizacion|senales?|senaletica)\b/, key: 'signage' },
  { re: /\b(?:instrumentacion|sensores?|monitoreo|acelerometros?|galgas?)\b/, key: 'instrumentation' },
  { re: /\b(?:control|controlador(?:es)?|embebidos?|automatizacion|domotica|dmx|fotocelda)\b/, key: 'control' },
];

/** Tipologías o elementos que este generador no cubre. */
const UNSUPPORTED = [
  { re: /\b(?:colgante|suspension)\b/, text: 'puentes colgantes' },
  { re: /\b(?:arco|en arco)\b/, text: 'puentes en arco' },
  { re: /\b(?:cercha|reticulad[oa]|celosia)\b/, text: 'puentes en celosía' },
  { re: /\b(?:basculante|giratorio|levadizo)\b/, text: 'puentes móviles' },
  { re: /\b(?:curva (?:horizontal|en planta)|planta curva|esviaje|esviad[oa])\b/, text: 'trazados curvos o esviados' },
  { re: /\b(?:peraltes?|pendiente longitudinal|rasante inclinada)\b/, text: 'peraltes y rasantes inclinadas' },
];

/**
 * True si el enunciado describe una edificación en vez de un puente.
 *
 * Basta con un indicio inequívoco de edificio y ninguna palabra de puente: así
 * un texto que mezcle ambos («puente peatonal de acceso al edificio») no se
 * desvía por error.
 */
function describesBuilding(text: string): boolean {
  const buildingHints =
    /\b(?:edificio|edificacion|niveles?|pisos?|plantas?|oficinas?|aulas?|apartament|vivienda)\b/;
  const bridgeHints = /\b(?:puente|tablero|viaducto|pasarela|estribos?|atirantad|vanos?)\b/;
  return buildingHints.test(text) && !bridgeHints.test(text);
}

export function interpretBridgePrompt(prompt: string): BridgeSpecification {
  const text = normalize(prompt);

  // Si el enunciado nombra una obra real documentada, se carga su ficha en vez
  // de interpretar el texto. Un reparto de vanos o unas coordenadas no son
  // deducibles de una frase: o están registrados con su fuente, o no existen.
  const reference = matchReferenceBridge(text);
  if (reference) return specificationFor(reference);

  const assumptions: string[] = [
    'Interpretación local por reglas y patrones de texto; no se usó un modelo de IA ni se envió información a ningún servicio externo.',
  ];
  const questions: string[] = [];
  const unrecognized: string[] = [];

  // --- tipología ---
  let bridgeType: BridgeType = 'beam';
  let typeStated = true;
  if (/\b(?:atirantad[oa]s?|cable[- ]stayed|tirantes?)\b/.test(text)) {
    bridgeType = 'cable_stayed';
  } else if (/\b(?:en arco|de arco|arco de |tipo arco|arch)\b/.test(text)) {
    bridgeType = 'arch';
  } else if (/\b(?:de losa|losa maciza|tipo losa)\b/.test(text)) {
    bridgeType = 'slab';
  } else if (/\b(?:de vigas?|vigas? postensad|vigas? pretensad|tipo viga)\b/.test(text)) {
    bridgeType = 'beam';
  } else {
    typeStated = false;
  }
  if (!typeStated) {
    assumptions.push(
      'No se indicó la tipología, así que se genera un puente de vigas, que es el caso más común en luces medias.',
    );
  }

  // --- dimensiones ---
  // Se prueba primero la etiqueta inequívoca y solo después la genérica: en un
  // enunciado de puente hay muchos «ancho» y muchas «altura» que no son los del
  // tablero (ancho de viga, altura de barrera…).
  const lengthM = firstMeasurement(text, [
    'longitud total|luz total',
    'longitud|largo',
  ]);
  const widthM = firstMeasurement(text, [
    'ancho (?:del |de )?(?:tablero|puente|calzada)|ancho total',
    'ancho|anchura',
  ]);
  const deckHeightM = firstMeasurement(text, [
    '(?:altura|cota) (?:del |de )?tablero',
    'tablero (?:a|de) ',
    'altura sobre el (?:terreno|cauce|rio|suelo|nivel)|galibo',
    'altura',
  ]);

  if (lengthM === null) {
    questions.push('¿Qué longitud total tiene el puente? Sin ese dato no se puede repartir en vanos.');
  }
  if (widthM === null) {
    questions.push('¿Qué ancho de tablero tiene? Define calzada, aceras y barreras.');
  }
  if (deckHeightM === null) {
    questions.push(
      '¿A qué altura queda el tablero sobre el terreno? Define las pilas, los estribos y la cimentación.',
    );
  }

  // --- vanos, vigas, carriles ---
  const spanCount = count(text, 'vanos?|luces|tramos?');
  const girderCount = count(text, 'vigas?(?: principales| longitudinales)?');
  const lanes = count(text, 'carriles?|calzadas? de');

  if (spanCount === null && lengthM !== null) {
    assumptions.push(
      'No se indicó el número de vanos; el generador lo deduce de la luz máxima conceptual de la tipología.',
    );
  }
  if (bridgeType === 'beam' && girderCount === null) {
    assumptions.push(
      'No se indicó el número de vigas principales; el generador adopta las que caben en el ancho útil.',
    );
  }
  if (lanes === null) {
    assumptions.push(
      'No se indicó el número de carriles; el generador adopta los que caben en la calzada útil.',
    );
  }

  // --- aceras ---
  let sidewalks: boolean | null = null;
  if (/\b(?:sin aceras?|sin andenes?|sin paso peatonal)\b/.test(text)) sidewalks = false;
  else if (/\b(?:aceras?|andenes?|paso peatonal|peatonal)\b/.test(text)) sidewalks = true;

  // --- disciplinas ---
  //
  // El vocabulario de dimensiones y el de disciplinas se solapan: «ancho de
  // tablero» nombra una medida, no una petición de generar solo el tablero. Por
  // eso la lista solo se recorta cuando el enunciado lo pide explícitamente; en
  // cualquier otro caso se generan las siete y se declara.
  const mentioned = Array.from(
    new Set(DISCIPLINE_PATTERNS.filter(({ re }) => re.test(text)).map(({ key }) => key)),
  );
  const restricts =
    /\b(?:solo|solamente|unicamente|exclusivamente)\b/.test(text) ||
    /\b(?:disciplinas?|especialidades)\b/.test(text);
  const wantsAll =
    /\btodas las (?:disciplinas|especialidades)\b|\bmultidisciplinari[oa]\b|\bcompleto\b/.test(text) ||
    !restricts ||
    mentioned.length === 0;
  const disciplines: BridgeDisciplineKey[] = wantsAll ? [...ALL_BRIDGE_DISCIPLINES] : mentioned;
  if (wantsAll) {
    assumptions.push(
      mentioned.length === 0
        ? 'No se nombró ninguna disciplina en particular, así que se generan las siete: estructura, tablero, barreras, drenaje, iluminación, señalización e instrumentación.'
        : 'El enunciado menciona disciplinas pero no pide restringirse a ellas, así que se generan las siete. Escribe «solo» o «únicamente» para limitar el alcance.',
    );
  }

  // --- lo que el intérprete no cubre ---
  for (const { re, text: what } of UNSUPPORTED) {
    if (re.test(text)) {
      unrecognized.push(what);
      questions.push(
        `El generador no modela ${what}. Esa parte quedará fuera del modelo; indícalo si es imprescindible.`,
      );
    }
  }

  // Un texto de edificio encaja sin problema en los patrones de longitud y
  // ancho, así que el estudio lo aceptaría en silencio y devolvería un puente
  // absurdo. Se detecta y se redirige al módulo que corresponde.
  if (describesBuilding(text)) {
    questions.push(
      'El texto describe un edificio, no un puente. Usa la pestaña Edificación (EMBEDVERSE BUILDING STUDIO) para generar un modelo multidisciplinario de edificación.',
    );
  }

  return {
    schemaVersion: 1,
    projectName: deriveName(prompt, bridgeType),
    bridgeType,
    units: 'm',
    lengthM,
    widthM,
    deckHeightM,
    spanCount,
    girderCount,
    lanes,
    sidewalks,
    disciplines,
    // El intérprete de lenguaje no deduce estos tres: un reparto de vanos, la
    // altura de torre de proyecto y el emplazamiento son datos de obra que se
    // cargan explícitamente, no frases que se adivinen de un enunciado.
    spanLengthsM: null,
    towerHeightM: null,
    site: null,
    assumptions,
    questions,
    unrecognized,
  };
}

function deriveName(prompt: string, type: BridgeType): string {
  const first = prompt.trim().split(/[.\n]/)[0]?.trim() ?? '';
  if (first.length >= 8 && first.length <= 80) return first;
  return BRIDGE_TYPE_LABEL[type];
}

/** True si la especificación tiene lo mínimo para generar sin inventar nada. */
export function isReadyToGenerate(spec: BridgeSpecification): boolean {
  return spec.lengthM !== null && spec.widthM !== null && spec.deckHeightM !== null;
}

/** Resumen legible de lo entendido, para mostrarlo antes de generar. */
export function describeSpecification(spec: BridgeSpecification): string[] {
  const lines: string[] = [];
  lines.push(BRIDGE_TYPE_LABEL[spec.bridgeType]);
  const dim =
    spec.lengthM !== null && spec.widthM !== null
      ? `${spec.lengthM.toFixed(2)} m de longitud × ${spec.widthM.toFixed(2)} m de ancho`
      : 'dimensiones sin definir';
  lines.push(dim);
  if (spec.deckHeightM !== null) lines.push(`Tablero a ${spec.deckHeightM.toFixed(2)} m sobre el terreno`);
  if (spec.spanCount !== null) lines.push(`${spec.spanCount} vanos solicitados`);
  if (spec.girderCount !== null) lines.push(`${spec.girderCount} vigas principales solicitadas`);
  if (spec.lanes !== null) lines.push(`${spec.lanes} carriles solicitados`);
  if (spec.sidewalks !== null) lines.push(spec.sidewalks ? 'Con aceras' : 'Sin aceras');
  lines.push(`Disciplinas: ${spec.disciplines.length}`);
  return lines;
}
