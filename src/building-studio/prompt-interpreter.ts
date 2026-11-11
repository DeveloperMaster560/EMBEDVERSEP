/**
 * Intérprete local de solicitudes de edificio en español.
 *
 * Es un intérprete DETERMINISTA de reglas y patrones de texto, igual que el de
 * puentes: no es un modelo entrenado, no aprende y no envía nada a ningún
 * servicio externo. Reconoce un vocabulario acotado y declara explícitamente
 * lo que no entendió, en vez de rellenarlo con un valor plausible.
 */

import {
  ALL_DISCIPLINES,
  type BandKey,
  type BuildingSpecification,
  type BuildingUse,
  type DisciplineKey,
  type RoomUse,
} from './contracts';
import { matchReferenceBuilding, specificationForBuilding } from './reference-buildings';

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

/** Busca "<etiqueta> ... <número> <unidad>" o "<número> <unidad> de <etiqueta>". */
function measurement(text: string, labels: string): number | null {
  const forward = new RegExp(
    `(?:${labels})[^.;\\n]{0,30}?(\\d+(?:[.,]\\d+)?)\\s*${UNIT}\\b`,
  );
  const backward = new RegExp(
    `(\\d+(?:[.,]\\d+)?)\\s*${UNIT}\\s+(?:de\\s+)?(?:${labels})\\b`,
  );
  for (const re of [forward, backward]) {
    const m = re.exec(text);
    if (m) {
      const value = toMeters(m[1], m[2]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

/** Busca una cantidad entera asociada a una etiqueta, en dígito o palabra. */
function count(text: string, labels: string): number | null {
  const digits = new RegExp(`(\\d{1,3})\\s*(?:${labels})\\b`).exec(text);
  if (digits) {
    const n = Number.parseInt(digits[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const words = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\s+(?:${labels})\\b`).exec(text);
  if (words) return NUMBER_WORDS[words[1]];
  const after = new RegExp(`(?:${labels})[^.;\\n]{0,20}?(\\d{1,3})\\b`).exec(text);
  if (after) {
    const n = Number.parseInt(after[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** "24 x 18" o "24 por 18", con o sin unidad. */
function planDimensions(text: string): [number, number] | null {
  const re = new RegExp(
    `(\\d+(?:[.,]\\d+)?)\\s*(?:${UNIT}\\s*)?(?:x|por)\\s*(\\d+(?:[.,]\\d+)?)\\s*${UNIT}?`,
  );
  const m = re.exec(text);
  if (!m) return null;
  const unit = m[4] ?? m[2] ?? 'm';
  const a = toMeters(m[1], unit);
  const b = toMeters(m[3], unit);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  return [a, b];
}

const USE_PATTERNS: { re: RegExp; use: BuildingUse }[] = [
  { re: /\b(?:institucional|administrativ[oa]|gubernamental|alcaldia|ministerio)\b/, use: 'institucional-administrativo' },
  { re: /\b(?:oficinas?|corporativ[oa]|empresarial)\b/, use: 'oficinas' },
  { re: /\b(?:educativ[oa]|colegio|escuela|universidad|facultad|aulas?)\b/, use: 'educativo' },
  { re: /\b(?:salud|clinica|hospital|centro medico)\b/, use: 'salud' },
  { re: /\b(?:mixt[oa]|uso mixto)\b/, use: 'mixto' },
];

const ROOM_PATTERNS: { re: RegExp; label: string; use: RoomUse; band: BandKey }[] = [
  { re: /\baulas?\b/, label: 'aulas?', use: 'aula', band: 'SOUTH' },
  { re: /\blaboratorios?\b/, label: 'laboratorios?', use: 'laboratorio', band: 'EAST' },
  { re: /\bsalas? de juntas?\b/, label: 'salas? de juntas?', use: 'sala_juntas', band: 'SOUTH' },
  { re: /\bsalas? de reunion(?:es)?\b/, label: 'salas? de reunion(?:es)?', use: 'sala_reuniones', band: 'SOUTH' },
  { re: /\bdepositos?\b|\bbodegas?\b/, label: 'depositos?|bodegas?', use: 'deposito', band: 'EAST' },
  { re: /\barchivos?\b/, label: 'archivos?', use: 'archivo', band: 'EAST' },
];

const DISCIPLINE_PATTERNS: { re: RegExp; key: DisciplineKey }[] = [
  { re: /\b(?:arquitectonic[oa]|arquitectura)\b/, key: 'architecture' },
  { re: /\b(?:estructural|estructura|porticos)\b/, key: 'structure' },
  { re: /\b(?:electric[oa]|iluminacion|tomacorrientes)\b/, key: 'electrical' },
  { re: /\b(?:telecomunicaciones|red de datos|cableado estructurado|wifi)\b/, key: 'telecommunications' },
  { re: /\b(?:hidrosanitari[oa]|hidraulic[oa]|sanitari[oa]|agua potable|desagues?)\b/, key: 'hydrosanitary' },
  { re: /\b(?:climatizacion|hvac|aire acondicionado|ventilacion mecanica)\b/, key: 'hvac' },
  { re: /\b(?:seguridad|cctv|deteccion de humo|control de acceso|incendios?)\b/, key: 'security' },
];

/** Tipologías que este generador no cubre. */
const UNSUPPORTED = [
  { re: /\bsotano|subterrane[oa]|parqueadero subterraneo\b/, text: 'sótanos' },
  { re: /\bascensor(?:es)?|elevador(?:es)?\b/, text: 'ascensores' },
  { re: /\bcubierta (?:inclinada|a dos aguas)|techo inclinado\b/, text: 'cubiertas inclinadas' },
  { re: /\bmuro cortina|fachada ventilada\b/, text: 'muros cortina' },
  { re: /\bplanta (?:irregular|en l|en u|circular)\b/, text: 'plantas no rectangulares' },
];

export function interpretBuildingPrompt(prompt: string): BuildingSpecification {
  const text = normalize(prompt);
  const assumptions: string[] = [
    'Interpretación local por reglas y patrones de texto; no se usó un modelo de IA ni se envió información a ningún servicio externo.',
  ];
  const questions: string[] = [];
  const unrecognized: string[] = [];

  // --- niveles ---
  const levels =
    count(text, 'niveles?|pisos?|plantas?|alturas?') ??
    (/(?:de|con)\s+(?:un|una)\s+(?:nivel|piso|planta)\b/.test(text) ? 1 : null);
  if (levels === null) {
    questions.push('¿Cuántos niveles tiene el edificio? Sin ese dato no se puede generar la estructura.');
  }

  // --- dimensiones en planta ---
  let lengthXM = measurement(text, 'longitud|largo|frente');
  let widthYM = measurement(text, 'ancho|fondo|profundidad');
  const pair = planDimensions(text);
  if ((lengthXM === null || widthYM === null) && pair) {
    const [a, b] = pair;
    lengthXM = lengthXM ?? Math.max(a, b);
    widthYM = widthYM ?? Math.min(a, b);
    assumptions.push(
      `Se interpretó "${pair[0]} x ${pair[1]}" como las dimensiones en planta; el valor mayor se tomó como longitud.`,
    );
  }
  if (lengthXM === null || widthYM === null) {
    questions.push('¿Qué dimensiones tiene la planta (longitud y ancho en metros)?');
  }

  // --- alturas ---
  const clearHeightM = measurement(text, 'altura libre|altura util|libre por piso');
  const floorToFloorM = measurement(
    text,
    'altura entre niveles|entre niveles|entrepiso|altura de piso a piso|piso a piso',
  );

  // Un edificio real nombrado carga su ficha; del enunciado solo se toman las
  // alturas, que las fuentes públicas no dan y el usuario puede medir.
  const reference = matchReferenceBuilding(prompt);
  if (reference) return specificationForBuilding(reference, { clearHeightM, floorToFloorM });
  if (clearHeightM !== null && floorToFloorM === null) {
    assumptions.push(
      'Solo se indicó la altura libre; la altura entre niveles la deduce el generador sumando el canto de viga y losa.',
    );
  }
  if (clearHeightM === null && floorToFloorM === null) {
    questions.push('¿Qué altura libre o qué altura entre niveles debe tener cada piso?');
  }

  // --- circulación y núcleo ---
  const corridorWidthM = measurement(text, 'circulacion|pasillo|corredor');
  const corePair = /nucleo[^.;\n]{0,40}?(\d+(?:[.,]\d+)?)\s*(?:x|por)\s*(\d+(?:[.,]\d+)?)/.exec(text);
  const coreSizeM: [number, number] | null = corePair
    ? [Number.parseFloat(corePair[1].replace(',', '.')), Number.parseFloat(corePair[2].replace(',', '.'))]
    : null;

  // --- uso ---
  let buildingUse: BuildingUse = 'desconocido';
  for (const { re, use } of USE_PATTERNS) {
    if (re.test(text)) {
      buildingUse = use;
      break;
    }
  }
  if (buildingUse === 'desconocido') {
    questions.push('¿Cuál es el uso del edificio? El uso define el programa de recintos.');
  }

  // --- recintos pedidos explícitamente ---
  const roomsByBand: BuildingSpecification['roomsByBand'] = {};
  for (const { re, label, use, band } of ROOM_PATTERNS) {
    if (!re.test(text)) continue;
    const qty = count(text, label) ?? 1;
    const bandBucket = roomsByBand[band] ?? {};
    bandBucket[use] = (bandBucket[use] ?? 0) + qty;
    roomsByBand[band] = bandBucket;
  }

  // --- disciplinas ---
  const mentioned = DISCIPLINE_PATTERNS.filter(({ re }) => re.test(text)).map(({ key }) => key);
  const wantsAll =
    /\btodas las (?:disciplinas|especialidades)|multidisciplinari[oa]|completo\b/.test(text) ||
    mentioned.length === 0;
  const disciplines: DisciplineKey[] = wantsAll ? [...ALL_DISCIPLINES] : mentioned;
  if (wantsAll && mentioned.length === 0) {
    assumptions.push(
      'No se nombró ninguna disciplina en particular, así que se generan las siete: arquitectura, estructura, eléctrico, telecomunicaciones, hidrosanitario, climatización y seguridad.',
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

  const projectName = deriveName(prompt, buildingUse);

  return {
    schemaVersion: 1,
    projectName,
    buildingUse,
    units: 'm',
    levels,
    lengthXM,
    widthYM,
    clearHeightM,
    floorToFloorM,
    corridorWidthM,
    coreSizeM,
    roomsByBand,
    disciplines,
    assumptions,
    questions,
    unrecognized,
  };
}

function deriveName(prompt: string, use: BuildingUse): string {
  const first = prompt.trim().split(/[.\n]/)[0]?.trim() ?? '';
  if (first.length >= 8 && first.length <= 80) return first;
  const byUse: Record<BuildingUse, string> = {
    'institucional-administrativo': 'Edificio institucional',
    oficinas: 'Edificio de oficinas',
    educativo: 'Edificio educativo',
    salud: 'Edificio de salud',
    mixto: 'Edificio de uso mixto',
    desconocido: 'Edificio de referencia',
  };
  return byUse[use];
}

/** True si la especificación tiene lo mínimo para generar sin inventar nada. */
export function isReadyToGenerate(spec: BuildingSpecification): boolean {
  return (
    spec.levels !== null &&
    spec.lengthXM !== null &&
    spec.widthYM !== null &&
    (spec.clearHeightM !== null || spec.floorToFloorM !== null)
  );
}

/** Resumen legible de lo entendido, para mostrarlo antes de generar. */
export function describeSpecification(spec: BuildingSpecification): string[] {
  const lines: string[] = [];
  const dim =
    spec.lengthXM !== null && spec.widthYM !== null
      ? `${spec.lengthXM.toFixed(2)} x ${spec.widthYM.toFixed(2)} m`
      : 'dimensiones sin definir';
  lines.push(`${spec.levels ?? '?'} niveles · ${dim}`);
  if (spec.clearHeightM !== null) lines.push(`Altura libre ${spec.clearHeightM.toFixed(2)} m`);
  if (spec.floorToFloorM !== null) lines.push(`Entre niveles ${spec.floorToFloorM.toFixed(2)} m`);
  lines.push(`Uso: ${spec.buildingUse}`);
  lines.push(`Disciplinas: ${spec.disciplines.length}`);
  return lines;
}
